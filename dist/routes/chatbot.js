"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const openai_1 = __importDefault(require("./openai"));
const tools_1 = require("./tools");
const chatbotRoutes = express_1.default.Router();
const chatHandler = async (req, res, next) => {
    try {
        const { thread_id, user_message } = req.body;
        // Paso 1: Crear un mensaje con el thread_id y el user_message
        const message = await openai_1.default.beta.threads.messages.create(thread_id, {
            role: 'user',
            content: user_message,
        });
        console.log('Message ====> ', message);
        // Paso 2: Ejecutar un "run" en el thread
        let run = await openai_1.default.beta.threads.runs.create(thread_id, {
            assistant_id: 'asst_XZlMHuyYuXe3Lq4mqcHJ7i1F',
        });
        console.log('Run ====> ', run);
        // Paso 3: Manejar el run y esperar a que se complete
        run = await handleRun(thread_id, run.id);
        // Verificar si el run se completó con éxito
        if (run.status === 'completed') {
            // Paso 4: Obtener los mensajes del thread
            const threadMessages = await openai_1.default.beta.threads.messages.list(thread_id);
            console.log('Thread Messages ======> ', threadMessages);
            // Extraer el mensaje del asistente
            const aiMessage = extractAssistantMessage(threadMessages);
            // Retornar la respuesta del asistente
            res.json({ response: aiMessage });
            return;
        }
        else {
            // Manejar si el run falló o expiró
            res.status(500).json({ error: 'El procesamiento del asistente no se completó correctamente' });
            return;
        }
    }
    catch (error) {
        console.error('Error en la interacción con el chatbot:', error);
        next(error);
    }
};
// Función para manejar el run, incluyendo el estado 'requires_action'
async function handleRun(threadId, runId, timeout = 30000, interval = 1000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        // Obtener el estado del run
        const runStatus = await openai_1.default.beta.threads.runs.retrieve(threadId, runId);
        console.log('Estado actual del run: ', runStatus.status);
        if (runStatus.status === 'completed') {
            return runStatus;
        }
        else if (runStatus.status === 'requires_action') {
            const requiredAction = runStatus.required_action;
            console.log('requiredAction:', JSON.stringify(requiredAction, null, 2));
            console.log('Tipo de acción requerida:', requiredAction.type);
            if (requiredAction.type === 'submit_tool_outputs') {
                // Manejar la acción requerida
                await handleSubmitToolOutputs(threadId, runId, requiredAction);
            }
            else {
                throw new Error(`Tipo de acción requerida no manejada: ${requiredAction.type}`);
            }
        }
        else if (runStatus.status === 'failed') {
            throw new Error('El run falló');
        }
        // Esperar antes de verificar nuevamente
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    // Si se alcanza el tiempo de espera
    throw new Error('El run excedió el tiempo de espera');
}
async function handleSubmitToolOutputs(threadId, runId, requiredAction) {
    console.log('requiredAction:', JSON.stringify(requiredAction, null, 2));
    const submitToolOutputs = requiredAction.submit_tool_outputs;
    if (!submitToolOutputs) {
        throw new Error('submit_tool_outputs no está presente en requiredAction');
    }
    const toolCalls = submitToolOutputs.tool_calls;
    if (!Array.isArray(toolCalls)) {
        throw new Error('tool_calls no es un arreglo');
    }
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id;
        const functionName = toolCall.function.name;
        const functionArguments = toolCall.function.arguments; // Asumimos que aquí se encuentran los argumentos
        console.log("functionName ========> ", functionName);
        console.log("toolCallId ========> ", toolCallId);
        console.log("functionArguments ========> ", functionArguments);
        console.log(`Ejecutando herramienta: ${functionName}`);
        // Ejecutar la función correspondiente al nombre de la herramienta
        let toolOutputMessage;
        switch (functionName) {
            case 'deliveryStatus':
                if (functionArguments) {
                    let parsedArguments;
                    try {
                        parsedArguments = JSON.parse(functionArguments);
                    }
                    catch (e) {
                        toolOutputMessage = 'Error: Los argumentos de la función no son un JSON válido.';
                        break;
                    }
                    if (parsedArguments.orderNumber) {
                        toolOutputMessage = await tools_1.tools.deliveryStatus(parsedArguments.orderNumber);
                    }
                    else {
                        toolOutputMessage = 'Error: Falta el parámetro orderNumber';
                    }
                }
                else {
                    toolOutputMessage = 'Error: No se proporcionaron argumentos para la función.';
                }
                break;
            case 'catalogProducts':
                toolOutputMessage = await tools_1.tools.catalogProducts();
                break;
            case 'similarProducts':
                if (functionArguments) {
                    let parsedArguments;
                    try {
                        parsedArguments = JSON.parse(functionArguments);
                    }
                    catch (e) {
                        toolOutputMessage = 'Error: Los argumentos de la función no son un JSON válido.';
                        break;
                    }
                    if (parsedArguments.imageUrl) {
                        toolOutputMessage = await tools_1.tools.similarProducts(parsedArguments.imageUrl);
                    }
                    else {
                        toolOutputMessage = 'Error: Falta el parámetro imageUrl';
                    }
                }
                else {
                    toolOutputMessage = 'Error: No se proporcionaron argumentos para la función.';
                }
                break;
            case 'createCheckout':
                if (functionArguments) {
                    let parsedArguments;
                    try {
                        parsedArguments = JSON.parse(functionArguments);
                    }
                    catch (e) {
                        toolOutputMessage = 'Error: Los argumentos de la función no son un JSON válido.';
                        break;
                    }
                    if (parsedArguments.lineItems && Array.isArray(parsedArguments.lineItems)) {
                        const lineItems = parsedArguments.lineItems;
                        // Validar que cada lineItem tenga 'variantId' y 'quantity'
                        const invalidItem = lineItems.find((item) => !item.variantId || !item.quantity);
                        if (invalidItem) {
                            toolOutputMessage = 'Error: Cada lineItem debe tener "variantId" y "quantity".';
                        }
                        else {
                            try {
                                toolOutputMessage = await tools_1.tools.createCheckout(lineItems);
                            }
                            catch (error) {
                                toolOutputMessage = error.message || 'Error al crear el checkout.';
                            }
                        }
                    }
                    else {
                        toolOutputMessage = 'Error: Falta el parámetro lineItems o no es un arreglo válido.';
                    }
                }
                else {
                    toolOutputMessage = 'Error: No se proporcionaron argumentos para la función.';
                }
                break;
            default:
                toolOutputMessage = 'Tool not recognized';
        }
        // Recopilar el output
        toolOutputs.push({
            tool_call_id: toolCallId,
            output: toolOutputMessage,
        });
        console.log("Tool Outputs ================> ", {
            tool_call_id: toolCallId,
            output: toolOutputMessage,
        });
    }
    // Enviar los resultados de las herramientas a la API
    await openai_1.default.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs,
    });
    console.log(`Outputs de las herramientas enviados para el run ${runId}`);
}
// Función para extraer el mensaje del asistente
function extractAssistantMessage(threadMessages) {
    const messages = threadMessages.data;
    // Filtrar los mensajes del asistente
    const assistantMessages = messages.filter((msg) => msg.role === 'assistant');
    if (assistantMessages.length > 0) {
        // Obtener el último mensaje del asistente
        const lastAssistantMessage = assistantMessages[0];
        const aiMessage = lastAssistantMessage.content[0]?.text?.value || 'No hay respuesta del asistente';
        return aiMessage;
    }
    else {
        return 'No se encontró respuesta del asistente';
    }
}
chatbotRoutes.post('/', chatHandler);
exports.default = chatbotRoutes;
