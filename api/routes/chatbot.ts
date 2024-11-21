import express, { Request, Response, NextFunction } from 'express';
import openai from './openai'; // API de OpenAI
import { tools } from './tools'; // Herramientas integradas (Shopify, etc.)
import twilio from 'twilio';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const chatbotRoutes = express.Router();

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Función principal del chatbot
 * Maneja la interacción entre OpenAI, herramientas y Twilio
 */
// Cola para almacenar los mensajes de cada usuario
const messageQueue: { [key: string]: { messages: string[]; timer: NodeJS.Timeout | null } } = {};

/**
 * Función principal del chatbot con temporizador
 */
const chatHandler: AsyncRequestHandler = async (req, res, next) => {
    try {
        const user_message = req.body.Body; // Twilio envía el mensaje en 'Body'
        const userPhoneNumber = req.body.From; // Twilio envía el número del usuario en 'From'

        if (!user_message || !userPhoneNumber) {
            res.status(400).json({ error: "Faltan datos en la solicitud." });
            return;
        }

        console.log(`Mensaje recibido de ${userPhoneNumber}: ${user_message}`);

        // Inicializa la cola del usuario si no existe
        if (!messageQueue[userPhoneNumber]) {
            messageQueue[userPhoneNumber] = { messages: [], timer: null };
        }

        // Agrega el mensaje recibido a la cola
        messageQueue[userPhoneNumber].messages.push(user_message);

        // Reinicia el temporizador si ya existe
        if (messageQueue[userPhoneNumber].timer) {
            clearTimeout(messageQueue[userPhoneNumber].timer);
        }

        // Configura un nuevo temporizador para procesar los mensajes
        messageQueue[userPhoneNumber].timer = setTimeout(async () => {
            try {
                // Combina todos los mensajes del usuario en uno solo
                const combinedMessage = messageQueue[userPhoneNumber].messages.join(" ");
                console.log(`Procesando mensajes combinados de ${userPhoneNumber}: ${combinedMessage}`);

                // Limpia la cola después de procesar
                delete messageQueue[userPhoneNumber];

                // Procesa el mensaje combinado con OpenAI
                let threadId = req.body.thread_id;
                if (!threadId) {
                    const thread = await openai.beta.threads.create();
                    threadId = thread.id;
                }

                // Crear mensaje en el thread
                const message = await openai.beta.threads.messages.create(threadId, {
                    role: "user",
                    content: combinedMessage.trim(),
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
                        from: "whatsapp:+14155238886",
                        to: userPhoneNumber,
                    });

                    console.log(`Respuesta enviada a ${userPhoneNumber}: ${aiMessage}`);
                } else {
                    console.error(`El run no se completó para ${userPhoneNumber}`);
                }
            } catch (error) {
                console.error("Error procesando la cola de mensajes:", error);
            }
        }, 10000); // Tiempo de espera (10 segundos)

        // Responde inmediatamente para confirmar recepción
        res.status(200).send("Mensaje recibido.");
    } catch (error) {
        console.error("Error en el chatHandler:", error);
        next(error);
    }
};





/**
 * Manejar el estado del run (threads, herramientas, etc.)
 */
async function handleRun(threadId: string, runId: string, timeout = 30000, interval = 1000): Promise<any> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);

        if (runStatus.status === 'completed') {
            return runStatus;
        } else if (runStatus.status === 'requires_action') {
            const requiredAction = runStatus.required_action!;
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
 * Manejar acciones requeridas (e.g., tools)
 */
async function handleSubmitToolOutputs(threadId: string, runId: string, requiredAction: any) {
    const submitToolOutputs = requiredAction.submit_tool_outputs;
    const toolOutputs = [];

    for (const toolCall of submitToolOutputs.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArguments = toolCall.function.arguments;

        let toolOutputMessage: string;

        switch (functionName) {
            case 'deliveryStatus':
                toolOutputMessage = functionArguments
                    ? await tools.deliveryStatus(JSON.parse(functionArguments).orderNumber)
                    : 'Error: No se proporcionaron argumentos.';
                break;
            case 'catalogProducts':
                toolOutputMessage = await tools.catalogProducts();
                break;
            case 'similarProducts':
                toolOutputMessage = functionArguments
                    ? await tools.similarProducts(JSON.parse(functionArguments).imageUrl)
                    : 'Error: No se proporcionaron argumentos.';
                break;
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
function extractAssistantMessage(threadMessages: any) {
    const messages = threadMessages.data.filter((msg: any) => msg.role === 'assistant');
    return messages.length > 0
        ? messages[0].content[0]?.text?.value || 'No hay respuesta del asistente'
        : 'No se encontró respuesta del asistente';
}

chatbotRoutes.get('/test', async (req, res) => {
    res.json({ message: "¡Hola, mundo!" });
}
);

// Rutas principales
chatbotRoutes.post('/chat', chatHandler); // Interacción principal

export default chatbotRoutes;
