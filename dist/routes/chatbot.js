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
const chatHandler = async (req, res, next) => {
    try {
        const userMessage = req.body.Body; // Twilio envía el mensaje en 'Body'
        const userPhoneNumber = req.body.From; // Twilio envía el número del usuario en 'From'

        if (!userMessage || !userPhoneNumber) {
            return res.status(400).json({ error: "Faltan datos en la solicitud." });
        }

        console.log(`Mensaje recibido de ${userPhoneNumber}: ${userMessage}`);

        // Obtén o crea un threadId para este número de teléfono
        const threadId = await getOrCreateThreadId(userPhoneNumber);

        // Crear mensaje en el thread
        const message = await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: userMessage.trim(),
        });

        let run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: "asst_UFGyAkWkTwdknKwF7PEsZOod",
        });

        // Manejar el run
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

            // Responder a Twilio con un texto plano
            return res.set('Content-Type', 'text/plain').send("Mensaje recibido y procesado correctamente.");
        } else {
            console.error(`El run no se completó para ${userPhoneNumber}`);
            return res.status(500).json({ error: "El asistente no pudo completar el run." });
        }
    } catch (error) {
        console.error("Error en el chatHandler:", error);
        return res.status(500).json({ error: "Error interno en el servidor." });
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
                console.warn(`Acción requerida no manejada: ${requiredAction.type}`);
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
    if (messages.length === 0) {
        console.warn("No se encontró ningún mensaje del asistente.");
        return "El asistente no generó una respuesta.";
    }
    return messages[0]?.content || "Respuesta vacía del asistente.";
}

// Rutas principales
chatbotRoutes.get('/test', async (req, res) => {
    res.json({ message: "¡Hola, mundo!" });
});

chatbotRoutes.post('/chat', chatHandler, (req, res) => {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Gracias por tu mensaje, estamos procesando tu solicitud.');
    res.set('Content-Type', 'text/xml');
    res.send(twiml.toString());
});


module.exports = chatbotRoutes;
