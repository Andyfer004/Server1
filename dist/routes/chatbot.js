const express = require('express');
const openai = require('./openai'); // API de OpenAI
const { PrismaClient } = require('@prisma/client');
const twilio = require('twilio');

const chatbotRoutes = express.Router();
const prisma = new PrismaClient();

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function formatPhoneNumberForWhatsApp(phoneNumber) {
  const sanitizedNumber = phoneNumber.replace(/[^\d]/g, ""); // Elimina caracteres no numéricos
  return `whatsapp:+${sanitizedNumber}`;
}

async function sendPromotionalMessage(phoneNumber, message) {
  try {
    const formattedNumber = formatPhoneNumberForWhatsApp(phoneNumber);
    await twilioClient.messages.create({
      body: message,
      from: "whatsapp:+18178131389",
      to: formattedNumber,
    });
    console.log(`Mensaje promocional enviado a ${formattedNumber}`);
  } catch (error) {
    console.error(`Error al enviar mensaje a ${phoneNumber}:`, error);
  }
}

/**
 * Obtiene o crea una conversación en la nueva tabla UserConversation.
 */
async function getOrCreateConversation(phoneNumber) {
  let conversation = await prisma.userConversation.findUnique({
    where: { phoneNumber },
  });

  if (!conversation) {
    const newThread = await openai.beta.threads.create();
    conversation = await prisma.userConversation.create({
      data: {
        phoneNumber,
        threadId: newThread.id,
      },
    });
  }

  return conversation;
}

/**
 * Función para obtener la descripción de una imagen mediante OpenAI.
 */
async function describeImage(imageUrl) {
    try {
      console.log("📥 Descargando imagen desde:", imageUrl);
      
      // Crear el string de autenticación y codificarlo en base64.
      const authString = `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`;
      const base64Auth = Buffer.from(authString).toString("base64");
      
      // Descargar la imagen usando las credenciales de Twilio.
      const imageResponse = await fetch(imageUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "image/*",
          "Authorization": `Basic ${base64Auth}`
        },
      });
  
      if (!imageResponse.ok) {
        console.error("❌ No se pudo descargar la imagen:", imageResponse.status, imageResponse.statusText);
        throw new Error("No se pudo descargar la imagen.");
      }
  
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString("base64");
  
      // Enviar la imagen a OpenAI para obtener una descripción.
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4-turbo", // Usa el modelo con visión, si tienes acceso.
        messages: [
          {
            role: "system",
            content: "Eres un asistente que analiza imágenes de trading y finanzas.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analiza esta imagen y describe su contenido detalladamente." },
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } },
            ],
          },
        ],
      });
  
      const description = aiResponse.choices[0]?.message?.content?.trim();
      if (!description) throw new Error("No se obtuvo una descripción válida de la imagen.");
      return description;
    } catch (error) {
      console.error("Error al describir la imagen:", error);
      throw new Error("No se pudo obtener la descripción de la imagen. Inténtalo más tarde.");
    }
  }
  

/**
 * Maneja la conversación del chatbot y guarda los mensajes en la base de datos.
 */
const messageQueue = {}; // Cola para acumular mensajes por número de teléfono

const chatHandler = async (req, res, next) => {
  try {
    const userMessage = req.body.Body || "";
    const userPhoneNumber = req.body.From;
    const numMedia = parseInt(req.body.NumMedia || "0", 10);

    // Validar que venga al menos texto o media
    if (!userMessage && numMedia === 0) {
      return res.status(400).json({ error: "Faltan datos en la solicitud." });
    }

    console.log(`Mensaje recibido de ${userPhoneNumber}: ${userMessage}`);

    // Mensajes para OpenAI y BD
    let finalMessageForAI = userMessage.trim();
    let finalMessageForDB = userMessage.trim();
    let mediaUrlForDB = null;

    // Si hay imagen
    if (numMedia > 0) {
      const imageUrl = req.body.MediaUrl0;
      console.log(`Se detectó imagen en MediaUrl0: ${imageUrl}`);

      const imageDescription = await describeImage(imageUrl);
      console.log(`Descripción obtenida: ${imageDescription}`);

      // Si hay texto + imagen, concatenar todo en uno
      if (finalMessageForAI) {
        finalMessageForAI += `\n[Imagen adjunta] Descripción: ${imageDescription}`;
        finalMessageForDB += `\nImagen recibida: ${imageUrl}`;
      } else {
        finalMessageForAI = `[Imagen adjunta] Descripción: ${imageDescription}`;
        finalMessageForDB = `Imagen recibida: ${imageUrl}`;
      }

      mediaUrlForDB = imageUrl;
    } else {
      // Si no hay media, pero el texto contiene una URL de imagen
      const imageUrlRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif))/i;
      const imageUrlMatch = finalMessageForAI.match(imageUrlRegex);

      if (imageUrlMatch) {
        const imageUrl = imageUrlMatch[0];
        console.log(`Se detectó una URL de imagen: ${imageUrl}`);

        const imageDescription = await describeImage(imageUrl);
        console.log(`Descripción obtenida: ${imageDescription}`);

        finalMessageForAI = `${finalMessageForAI}\n[Imagen adjunta] Descripción: ${imageDescription}`;
        finalMessageForDB = `${finalMessageForDB}\nImagen recibida: ${imageUrl}`;
        mediaUrlForDB = imageUrl;
      }
    }

    // Crear la cola si no existe
    if (!messageQueue[userPhoneNumber]) {
      messageQueue[userPhoneNumber] = {
        timer: null,
        messages: [],
      };
    }

    // Si ya hay mensajes en la cola, concatenar al último (mismo hilo)
    const userQueue = messageQueue[userPhoneNumber];
    if (userQueue.messages.length > 0) {
      // Tomar el último mensaje acumulado y concatenar
      const lastMessage = userQueue.messages.pop();
      lastMessage.forAI += `\n${finalMessageForAI}`;
      lastMessage.forDB += `\n${finalMessageForDB}`;

      // Si llega otra imagen, puedes decidir si guardar varias URLs o solo la primera
      if (mediaUrlForDB) {
        lastMessage.mediaUrl = mediaUrlForDB;
      }

      // Volver a meter el mensaje concatenado
      userQueue.messages.push(lastMessage);
    } else {
      // Si es el primer mensaje en la cola
      userQueue.messages.push({
        forAI: finalMessageForAI,
        forDB: finalMessageForDB,
        mediaUrl: mediaUrlForDB,
      });
    }

    // Reiniciar el temporizador (se procesa todo tras 10s de inactividad)
    if (userQueue.timer) {
      clearTimeout(userQueue.timer);
    }

    userQueue.timer = setTimeout(async () => {
      const concatenatedMessageForAI = userQueue.messages
        .map(msg => msg.forAI)
        .join('\n');

      const concatenatedMessageForDB = userQueue.messages
        .map(msg => msg.forDB)
        .join('\n');

      const mediaUrlsForDB = userQueue.messages
        .map(msg => msg.mediaUrl)
        .filter(url => !!url);

      console.log(`Mensajes concatenados de ${userPhoneNumber}: ${concatenatedMessageForAI}`);

      // Vaciar la cola
      userQueue.messages = [];
      delete userQueue.timer;

      // Obtener o crear la conversación
      const conversation = await getOrCreateConversation(userPhoneNumber);

      // Guardar el mensaje en la BD
      await prisma.userMessage.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: concatenatedMessageForDB,
          mediaUrl: mediaUrlsForDB.length > 0 ? mediaUrlsForDB[0] : null, // solo 1, si quieres
        },
      });

      // Enviar el mensaje a OpenAI
      await openai.beta.threads.messages.create(conversation.threadId, {
        role: "user",
        content: concatenatedMessageForAI,
      });

      let run = await openai.beta.threads.runs.create(conversation.threadId, {
        assistant_id: "asst_UFGyAkWkTwdknKwF7PEsZOod",
      });

      run = await handleRun(conversation.threadId, run.id);

      if (run.status === "completed") {
        const threadMessages = await openai.beta.threads.messages.list(conversation.threadId);
        const aiMessage = extractAssistantMessage(threadMessages);

        // Guardar la respuesta del asistente en la BD
        await prisma.userMessage.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: aiMessage,
            mediaUrl: null,
          },
        });

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
    }, 10000); // 10 segundos de inactividad

    res.status(200).send("Mensaje recibido y en espera para procesar.");
  } catch (error) {
    console.error("Error en el chatHandler:", error);
    next(error);
  }
};

  
function extractAssistantMessage(threadMessages) {
  const messages = threadMessages.data.filter((msg) => msg.role === 'assistant');
  return messages.length > 0
    ? messages[0].content[0]?.text?.value || 'No hay respuesta del asistente'
    : 'No se encontró respuesta del asistente';
}

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
 * Analiza las conversaciones almacenadas y las etiqueta.
 * Se actualiza para usar las tablas UserConversation y UserMessage.
 */
async function analyzeAndTagClients() {
  console.log("Iniciando análisis de conversaciones...");

  const MAX_TOKENS = 4000;
  const conversations = await prisma.userConversation.findMany();
  console.log(`Conversaciones encontradas: ${conversations.length}`);

  for (const conversation of conversations) {
    console.log(`Analizando conversación con phoneNumber: ${conversation.phoneNumber}`);

    try {
      const tags = [];
      const messagesRecords = await prisma.userMessage.findMany({
        where: { conversationId: conversation.id },
      });

      const userMessages = messagesRecords
        .filter((msg) => typeof msg.content === "string")
        .map((msg) => msg.content.trim());

      console.log(`Mensajes totales encontrados: ${userMessages.length}`);

      const uniqueMessages = [...new Set(userMessages)];
      console.log(`Mensajes únicos: ${uniqueMessages.length}`);

      if (uniqueMessages.length === 0) {
        console.log("No hay mensajes únicos válidos para procesar. Clasificando como 'interesado'.");
        tags.push("interesado");
        await prisma.userConversation.update({
          where: { id: conversation.id },
          data: { tags, updatedAt: new Date() },
        });
        console.log(`Conversación actualizada con tags: ${tags}`);
        continue;
      }

      const allUserMessages = uniqueMessages.join(" ");
      const limitedContent = truncateToMaxTokens(allUserMessages, MAX_TOKENS);

      console.log(`Contenido final para el modelo: ${limitedContent.length} caracteres.`);

      if (!limitedContent.trim()) {
        console.log("El contenido final está vacío. Clasificando como 'interesado'.");
        tags.push("interesado");
        await prisma.userConversation.update({
          where: { id: conversation.id },
          data: { tags, updatedAt: new Date() },
        });
        console.log(`Conversación actualizada con tags: ${tags}`);
        continue;
      }

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

      if (tags.length > 0) {
        await prisma.userConversation.update({
          where: { id: conversation.id },
          data: { tags, updatedAt: new Date() },
        });
        console.log(`Conversación actualizada con tags: ${tags}`);
      } else {
        console.log("No se encontraron tags válidos para actualizar.");
      }
    } catch (error) {
      console.error(`Error procesando la conversación ${conversation.id}:`, error);
    }
  }

  console.log("Análisis y etiquetado completados.");
}

/**
 * Trunca el texto para que no exceda el límite de tokens.
 */
function truncateToMaxTokens(content, maxTokens) {
  const tokens = content.split(" ");
  return tokens.length > maxTokens ? tokens.slice(-maxTokens).join(" ") : content;
}

// Rutas principales
chatbotRoutes.get('/test', async (req, res) => {
  res.json({ message: "¡Hola, mundo!" });
});

chatbotRoutes.post('/chat', chatHandler);

module.exports = {
  chatbotRoutes,
  analyzeAndTagClients,
  sendPromotionalMessage,
};