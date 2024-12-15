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
const messageQueue = {}; // Cola para acumular mensajes por número de teléfono

const chatHandler = async (req, res, next) => {
    try {
        const userMessage = req.body.Body;
        const userPhoneNumber = req.body.From;
        const numMedia = parseInt(req.body.NumMedia || "0", 10); // Número de archivos multimedia
        const mediaUrls = [];

        // Capturar URLs de imágenes enviadas
        for (let i = 0; i < numMedia; i++) {
            mediaUrls.push(req.body[`MediaUrl${i}`]);
        }

        console.log(`Mensaje recibido de ${userPhoneNumber}: ${userMessage}`);
        console.log(`Imágenes recibidas: ${mediaUrls.join(", ")}`);

        if (!userMessage && numMedia === 0) {
            res.status(400).json({ error: "Faltan datos en la solicitud." });
            return;
        }

        // Obtener o crear el threadId
        const threadId = await getOrCreateThreadId(userPhoneNumber);

        // Almacenar las imágenes en la base de datos (opcional)
        if (mediaUrls.length > 0) {
            for (const url of mediaUrls) {
                await prisma.image.create({
                    data: {
                        url,
                        threadId: threadId, // Asociar con el thread
                    },
                });
            }
        }

        // Enviar mensaje a OpenAI
        const openaiMessages = [
            {
                role: "user",
                content: userMessage || "Envié imágenes.",
            },
        ];

        // Si hay imágenes, agrega referencias al mensaje
        if (mediaUrls.length > 0) {
            mediaUrls.forEach((url) => {
                openaiMessages.push({
                    role: "user",
                    content: `Imagen enviada: ${url}`,
                });
            });
        }

        const message = await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: openaiMessages.map((msg) => msg.content).join("\n"),
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

        res.status(200).send("Mensaje procesado con éxito.");
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
