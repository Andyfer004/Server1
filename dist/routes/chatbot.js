const express = require('express');
const openai = require('./openai'); // API de OpenAI
const { PrismaClient } = require('@prisma/client'); // Prisma Client
const twilio = require('twilio');

const chatbotRoutes = express.Router();
const prisma = new PrismaClient(); // Inicializa Prisma

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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
const messageBuffer = {}; // Almacena mensajes y temporizadores por número de teléfono

const chatHandler = async (req, res, next) => {
    try {
        const userMessage = req.body.Body.trim();
        const userPhoneNumber = req.body.From;

        if (!userMessage || !userPhoneNumber) {
            res.status(400).json({ error: "Faltan datos en la solicitud." });
            return;
        }

        console.log(`Mensaje recibido de ${userPhoneNumber}: ${userMessage}`);

        // Si no hay un buffer para el número, inicialízalo
        if (!messageBuffer[userPhoneNumber]) {
            messageBuffer[userPhoneNumber] = { messages: [], timer: null };
        }

        // Agrega el mensaje al buffer
        messageBuffer[userPhoneNumber].messages.push(userMessage);

        // Reinicia el temporizador
        if (messageBuffer[userPhoneNumber].timer) {
            clearTimeout(messageBuffer[userPhoneNumber].timer);
        }

        messageBuffer[userPhoneNumber].timer = setTimeout(async () => {
            try {
                const threadId = await getOrCreateThreadId(userPhoneNumber);
                const contextMessages = messageBuffer[userPhoneNumber].messages.join('\n');

                // Crear un mensaje en el thread con todo el contexto
                await openai.beta.threads.messages.create(threadId, {
                    role: "user",
                    content: contextMessages,
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

                // Limpia el buffer
                delete messageBuffer[userPhoneNumber];
            } catch (error) {
                console.error("Error procesando los mensajes:", error);
            }
        }, 10000); // Espera 10 segundos de inactividad

        res.status(200).send("Mensaje recibido.");
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

/**
 * Extraer el mensaje del asistente
 */
function extractAssistantMessage(threadMessages) {
    const messages = threadMessages.data.filter((msg) => msg.role === 'assistant');
    return messages.length > 0
        ? messages[0].content[0]?.text?.value || 'No hay respuesta del asistente'
        : 'No se encontró respuesta del asistente';
}

// Rutas principales
chatbotRoutes.get('/test', async (req, res) => {
    res.json({ message: "¡Hola, mundo!" });
});

chatbotRoutes.post('/chat', chatHandler);

module.exports = chatbotRoutes;
