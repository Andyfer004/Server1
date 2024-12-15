const express = require('express');
const openai = require('./openai'); // API de OpenAI
const { PrismaClient } = require('@prisma/client'); // Prisma Client
const twilio = require('twilio');

const chatbotRoutes = express.Router();
const prisma = new PrismaClient(); // Inicializa Prisma


const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function formatPhoneNumberForWhatsApp(phoneNumber) {
    const sanitizedNumber = phoneNumber.replace(/[^\d]/g, ""); // Elimina caracteres no numéricos
    return `whatsapp:+${sanitizedNumber}`;
}


async function sendPromotionalMessage(phoneNumber, message) {
    try {
        const formattedNumber = formatPhoneNumberForWhatsApp(phoneNumber); // Formatea el número
        await twilioClient.messages.create({
            body: message,
            from: "whatsapp:+18178131389", // Tu número de Twilio
            to: formattedNumber,
        });
        console.log(`Mensaje promocional enviado a ${formattedNumber}`);
    } catch (error) {
        console.error(`Error al enviar mensaje a ${phoneNumber}:`, error);
    }
}


/**
 * Obtiene o crea un threadId para un número de teléfono
 */
async function getOrCreateThreadId(phoneNumber) {
    let thread = await prisma.thread.findUnique({
        where: { phoneNumber },
    });

    if (!thread) {
        // Crea un nuevo thread en OpenAI y guárdalo
        const newThread = await openai.beta.threads.create();
        thread = await prisma.thread.create({
            data: {
                phoneNumber,
                threadId: newThread.id,
            },
        });
    }

    return thread.threadId;
}

/**
 * Maneja la conversación del chatbot
 */
const messageQueue = {}; // Cola para acumular mensajes por número de teléfono

const chatHandler = async (req, res, next) => {
    try {
        const userMessage = req.body.Body;
        const userPhoneNumber = req.body.From;

        if (!userMessage || !userPhoneNumber) {
            res.status(400).json({ error: "Faltan datos en la solicitud." });
            return;
        }

        console.log(`Mensaje recibido de ${userPhoneNumber}: ${userMessage}`);

        // Agregar el mensaje a la cola
        if (!messageQueue[userPhoneNumber]) {
            messageQueue[userPhoneNumber] = {
                timer: null,
                messages: [],
            };
        }

        messageQueue[userPhoneNumber].messages.push(userMessage.trim());

        // Reiniciar el temporizador
        if (messageQueue[userPhoneNumber].timer) {
            clearTimeout(messageQueue[userPhoneNumber].timer);
        }

        messageQueue[userPhoneNumber].timer = setTimeout(async () => {
            // Concatenar mensajes
            const concatenatedMessage = messageQueue[userPhoneNumber].messages.join(' ');
            console.log(`Mensajes concatenados de ${userPhoneNumber}: ${concatenatedMessage}`);

            // Limpieza de la cola
            messageQueue[userPhoneNumber].messages = [];
            delete messageQueue[userPhoneNumber].timer;

            // Continuar con el flujo original
            const threadId = await getOrCreateThreadId(userPhoneNumber);

            const message = await openai.beta.threads.messages.create(threadId, {
                role: "user",
                content: concatenatedMessage,
            });

            let run = await openai.beta.threads.runs.create(threadId, {
                assistant_id: "asst_UFGyAkWkTwdknKwF7PEsZOod",
            });

            run = await handleRun(threadId, run.id);

            if (run.status === "completed") {
                const threadMessages = await openai.beta.threads.messages.list(threadId);
                const aiMessage = extractAssistantMessage(threadMessages);

                // Enviar respuesta a WhatsApp
                await twilioClient.messages.create({
                    body: aiMessage,
                    from: "whatsapp:+18178131389",
                    to: userPhoneNumber,
                });

                console.log(`Respuesta enviada a ${userPhoneNumber}: ${aiMessage}`);
            } else {
                console.error(`El run no se completó para ${userPhoneNumber}`);
            }
        }, 10000); // Espera de 10 segundos

        res.status(200).send("Mensaje recibido y en espera para procesar.");
    } catch (error) {
        console.error("Error en el chatHandler:", error);
        next(error);
    }
};


/**
 * Manejar el estado del run (threads, herramientas, etc.)
 */
async function handleRun(threadId, runId, timeout = 30000, interval = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);

        if (runStatus.status === 'completed') {
            return runStatus;
        } else if (runStatus.status === 'requires_action') {
            const requiredAction = runStatus.required_action;
            if (requiredAction.type === 'submit_tool_outputs') {
                await handleSubmitToolOutputs(threadId, runId, requiredAction);
            } else {
                throw new Error(`Tipo de acción requerida no manejada: ${requiredAction.type}`);
            }
        } else if (runStatus.status === 'failed') {
            throw new Error('El run falló');
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error('El run excedió el tiempo de espera');
}

/**
 * Manejar herramientas requeridas (e.g., tools)
 */
async function handleSubmitToolOutputs(threadId, runId, requiredAction) {
    const submitToolOutputs = requiredAction.submit_tool_outputs;
    const toolOutputs = [];

    for (const toolCall of submitToolOutputs.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArguments = toolCall.function.arguments;

        let toolOutputMessage;

        switch (functionName) {
            // Puedes agregar lógica adicional aquí para herramientas específicas
            default:
                toolOutputMessage = 'Tool not recognized';
        }

        toolOutputs.push({
            tool_call_id: toolCall.id,
            output: toolOutputMessage,
        });
    }

    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
}

async function analyzeAndTagClients() {
    console.log("Iniciando análisis de threads...");

    const MAX_TOKENS = 4000; // Máximo seguro para gpt-3.5-turbo
    const threads = await prisma.thread.findMany();
    console.log(`Threads encontrados: ${threads.length}`);

    for (const thread of threads) {
        console.log(`Analizando thread con phoneNumber: ${thread.phoneNumber}`);

        try {
            const tags = [];
            const messages = await openai.beta.threads.messages.list(thread.threadId);

            // Obtener mensajes válidos
            const userMessages = messages.data
                .filter((msg) => typeof msg.content === "string")
                .map((msg) => msg.content.trim());

            console.log(`Mensajes totales encontrados: ${userMessages.length}`);

            // Eliminar duplicados
            const uniqueMessages = [...new Set(userMessages)];
            console.log(`Mensajes únicos: ${uniqueMessages.length}`);

            // Si no hay mensajes válidos, marcar como interesado y continuar
            if (uniqueMessages.length === 0) {
                console.log("No hay mensajes únicos válidos para procesar. Clasificando como 'interesado'.");
                tags.push("interesado");
                await prisma.thread.update({
                    where: { id: thread.id },
                    data: { tags, lastProcessedAt: new Date() },
                });
                console.log(`Thread actualizado con tags: ${tags}`);
                continue;
            }

            // Combinar mensajes en un solo string
            const allUserMessages = uniqueMessages.join(" ");
            const limitedContent = truncateToMaxTokens(allUserMessages, MAX_TOKENS);

            console.log(`Contenido final para el modelo: ${limitedContent.length} caracteres.`);

            if (!limitedContent.trim()) {
                console.log("El contenido final está vacío. Clasificando como 'interesado'.");
                tags.push("interesado");
                await prisma.thread.update({
                    where: { id: thread.id },
                    data: { tags, lastProcessedAt: new Date() },
                });
                console.log(`Thread actualizado con tags: ${tags}`);
                continue;
            }

            // Crear prompt para clasificación
            const prompt = `
Eres un asistente que clasifica conversaciones. Clasifica al cliente como:
- "comprador": si muestra intención de comprar.
- "interesado": si muestra interés pero no confirma la compra.

Historial:
${limitedContent}

Responde con "comprador", "interesado" o "indeterminado".`;

            const response = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "Eres un asistente que clasifica conversaciones." },
                    { role: "user", content: prompt },
                ],
                max_tokens: 10,
            });

            const classification = response.choices[0]?.message?.content?.trim().toLowerCase();

            console.log(`Clasificación recibida: ${classification}`);

            if (classification === "comprador" || classification === "interesado") {
                tags.push(classification);
            } else {
                console.warn(`Clasificación no válida: ${classification}`);
            }

            // Actualizar los tags en la base de datos si hay alguno válido
            if (tags.length > 0) {
                await prisma.thread.update({
                    where: { id: thread.id },
                    data: { tags, lastProcessedAt: new Date() },
                });
                console.log(`Thread actualizado con tags: ${tags}`);
            } else {
                console.log("No se encontraron tags válidos para actualizar.");
            }
        } catch (error) {
            console.error(`Error procesando el thread ${thread.id}:`, error);
        }
    }

    console.log("Análisis y etiquetado completados.");
}

/**
 * Trunca el texto para que no exceda el límite de tokens.
 */
function truncateToMaxTokens(content, maxTokens) {
    const tokens = content.split(" "); // Aproximación simple para dividir en tokens
    return tokens.length > maxTokens ? tokens.slice(-maxTokens).join(" ") : content;
}




// Rutas principales
chatbotRoutes.get('/test', async (req, res) => {
    res.json({ message: "¡Hola, mundo!" });
});

chatbotRoutes.post('/chat', chatHandler);

module.exports = {
    chatbotRoutes,
    analyzeAndTagClients, // Asegúrate de que analyzeAndTagClients esté aquí.
    sendPromotionalMessage,
};
