const express = require('express');

const openai = require('./openai'); // API de OpenAI
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { saveOrder } = require("./tools");
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const chatbotRoutes = express.Router();
const prisma = new PrismaClient();

// Se eliminó la dependencia de Twilio
phoneNumber = "whatsapp:+50241080361";
const PUBLIC_BASE_URL = "https://pretty-experts-hunt.loca.lt";

// Configuración de Supabase
const supabase = createClient(
  'https://YOUR_SUPABASE_URL', // tu URL de Supabase
  'YOUR_SUPABASE_ANON_KEY'    // tu clave anónima de Supabase
);



chatbotRoutes.get("/orders/today", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: today } },
      orderBy: { createdAt: "desc" },
    });

    res.json({ orders });
  } catch (error) {
    console.error("Error al obtener pedidos del día:", error);
    res.status(500).json({ error: "Error al obtener pedidos del día." });
  }
});

// 📌 Obtener pedidos en un rango de fechas
chatbotRoutes.get("/orders/by-date", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Debes proporcionar startDate y endDate en formato YYYY-MM-DD." });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: "desc" },
    });

    res.json({ orders });
  } catch (error) {
    console.error("Error al obtener pedidos por fecha:", error);
    res.status(500).json({ error: "Error al obtener pedidos por fecha." });
  }
});

// 📌 Exportar pedidos a Excel o CSV
chatbotRoutes.get("/orders/export", async (req, res) => {
  try {
    const { startDate, endDate, format } = req.query;
    if (!startDate || !endDate || !format) {
      return res.status(400).json({ error: "Debes proporcionar startDate, endDate y el formato (excel o csv)." });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: "desc" },
    });

    if (format === "excel") {
      const filePath = await exportOrdersToExcel(orders);
      return res.download(filePath, "Pedidos.xlsx");
    } else if (format === "csv") {
      const filePath = await exportOrdersToCSV(orders);
      return res.download(filePath, "Pedidos.csv");
    } else {
      return res.status(400).json({ error: "Formato inválido, usa 'excel' o 'csv'." });
    }
  } catch (error) {
    console.error("Error al exportar pedidos:", error);
    res.status(500).json({ error: "Error al exportar pedidos." });
  }
});


chatbotRoutes.post('/broadcast', async (req, res, next) => {
  try {
    const { message, label } = req.body;

    if (!message) {
      return res.status(400).json({ error: "El mensaje es obligatorio." });
    }

    let users;
    if (label) {
      // Filtrar solo los usuarios con la etiqueta específica
      users = await prisma.userConversation.findMany({
        where: { label: label },
        select: { phoneNumber: true },
      });
    } else {
      // Si no se especifica una etiqueta, enviar a todos
      users = await prisma.userConversation.findMany({
        select: { phoneNumber: true },
      });
    }

    if (users.length === 0) {
      return res.status(404).json({ message: "No hay usuarios con esta etiqueta." });
    }

    console.log(`📢 Enviando mensaje a ${users.length} usuarios`);

    // Enviar el mensaje a cada usuario
    for (const user of users) {
      await sendWAHAMessage(user.phoneNumber, message);
    }

    return res.json({ message: `Mensaje enviado a ${users.length} usuarios.` });
  } catch (error) {
    console.error("Error en broadcast:", error);
    next(error);
  }
});


async function exportOrdersToExcel(orders) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pedidos");

  sheet.columns = [
    { header: "Nombre", key: "name", width: 20 },
    { header: "Apellido", key: "lastName", width: 20 },
    { header: "NIT", key: "nit", width: 15 },
    { header: "Producto", key: "product", width: 30 },
    { header: "Cantidad", key: "quantity", width: 10 },
    { header: "Fecha", key: "createdAt", width: 20 },
  ];

  orders.forEach((order) => {
    sheet.addRow({
      name: order.name,
      lastName: order.lastName,
      nit: order.nit || "N/A",
      product: order.product,
      quantity: order.quantity,
      createdAt: order.createdAt.toISOString(),
    });
  });

  const filePath = path.join(__dirname, "Pedidos.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function exportOrdersToCSV(orders) {
  const fields = ["name", "lastName", "nit", "product", "quantity", "createdAt"];
  const opts = { fields };
  const csv = parse(orders, opts);

  const filePath = path.join(__dirname, "Pedidos.csv");
  fs.writeFileSync(filePath, csv);
  return filePath;
}


function formatPhoneNumberForWhatsApp(phoneNumber) {
  const sanitizedNumber = phoneNumber.replace(/[^\d]/g, ""); // Elimina caracteres no numéricos
  // WAHA requiere el formato: número@c.us
  return `${sanitizedNumber}@c.us`;
}

// Función para enviar mensajes vía WAHA usando Axios
async function sendWAHAMessage(phoneNumber, message, mediaUrl = null) {
  try {
    const chatId = formatPhoneNumberForWhatsApp(phoneNumber);

    // 🔁 Reemplazar localhost en media URL si es necesario
    if (mediaUrl && mediaUrl.startsWith("http://localhost:3000")) {
      mediaUrl = mediaUrl.replace("http://localhost:3000", PUBLIC_BASE_URL);
    }

    const payload = {
      chatId: chatId,
      text: message,
      session: "default",
    };

    if (mediaUrl) {
      payload.media = {
        url: mediaUrl,
        caption: message,
      };
    }

    await axios.post("http://waha:3000/api/sendText", payload, {
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });

    console.log(`✅ Mensaje enviado a ${chatId} vía WAHA`);
  } catch (error) {
    console.error(`❌ Error al enviar mensaje a ${phoneNumber} con WAHA:`, error);
  }
}

async function sendPromotionalMessage(phoneNumber, message) {
  try {
    await sendWAHAMessage(phoneNumber, message);
    console.log(`Mensaje promocional enviado a ${phoneNumber} vía WAHA`);
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
    select: { id: true, threadId: true, isPaused: true }, // 🔹 Incluir `isPaused`
  });

  if (!conversation) {
    const newThread = await openai.beta.threads.create();
    conversation = await prisma.userConversation.create({
      data: {
        phoneNumber,
        threadId: newThread.id,
        isPaused: false, // 🔹 Nueva conversación inicia activa
      },
      select: { id: true, threadId: true, isPaused: true }, // 🔹 Asegurar que obtenemos `isPaused`
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

    // Configurar headers básicos para descargar la imagen (sin autorización)
    const headers = {
      "User-Agent": "Mozilla/5.0",
      "Accept": "image/"
    };

    const imageResponse = await fetch(imageUrl, {
      method: "GET",
      headers
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
const messageQueue = {};
const MESSAGE_DELAY_MS = 10000;

const chatHandler = async (req, res, next) => {
  try {
    let data = req.body;
    if (data.payload) data = data.payload;

    const userMessage = data.Body || data.body || "";
    const userPhoneNumber = data.From || data.from || "";
    const numMedia = data.hasMedia ? 1 : 0;

    if (!userMessage && numMedia === 0) {
      return res.status(400).json({ error: "Faltan datos en la solicitud." });
    }

    if (!messageQueue[userPhoneNumber]) {
      messageQueue[userPhoneNumber] = {
        messages: [],
        timeoutId: null,
        mediaUrls: [],
      };
    }

    const queue = messageQueue[userPhoneNumber];
    queue.messages.push(userMessage);

    if (numMedia > 0) {
      let imageUrl = data.media?.url || data.MediaUrl0 || null;
      if (imageUrl) queue.mediaUrls.push(imageUrl);
    }

    if (queue.timeoutId) clearTimeout(queue.timeoutId);

    queue.timeoutId = setTimeout(async () => {
      try {
        const conversation = await getOrCreateConversation(userPhoneNumber);
        if (conversation.isPaused) return;

        const combinedMessage = queue.messages.join("\n").trim();
        let finalMessageForAI = combinedMessage;
        let finalMessageForDB = combinedMessage;
        let mediaUrlForDB = null;

        if (queue.mediaUrls.length > 0) {
          for (const imageUrl of queue.mediaUrls) {
            const description = await describeImage(imageUrl);
            finalMessageForAI += `\n[Imagen adjunta] Descripción: ${description}`;
            finalMessageForDB += `\nImagen recibida: ${imageUrl}`;
            mediaUrlForDB = imageUrl;
          }
        }

        // Detectar intención del mensaje
const aiResponse = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [
    {
      role: "system",
      content: "Eres un asistente que clasifica intenciones del usuario.",
    },
    {
      role: "user",
      content: `Clasifica el siguiente mensaje en una de estas categorías:
- "pedido_real": si incluye claramente nombre completo, producto, cantidad y opcionalmente NIT. Ejemplo: "Juan Pérez, NIT 123456, 2 camisetas".
- "intención_de_pedido": si hay intención de comprar pero faltan datos como nombre o cantidad.
- "consulta": si es una pregunta o búsqueda de información.
- "otro": si no encaja con las anteriores.

Mensaje del usuario: """${combinedMessage}"""

Responde únicamente con una palabra: pedido_real, intención_de_pedido, consulta u otro.`,
    },
  ],
  temperature: 0,
  max_tokens: 10,
});

const intent = aiResponse.choices[0]?.message?.content?.trim().toLowerCase();
console.log(`🎯 Intención detectada: ${intent}`);

        // Guardar el mensaje en la base de datos
        await prisma.userMessage.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: finalMessageForDB,
            mediaUrl: mediaUrlForDB,
          },
        });

        // Procesar según la intención
        if (intent === "intención_de_pedido") {
          await sendWAHAMessage(
            userPhoneNumber,
            "¡Perfecto! Para procesar tu pedido, necesito:\n- Nombre y Apellido\n- NIT (opcional)\n- Producto\n- Cantidad\n\nPor favor, envíalos en un solo mensaje."
          );
        } else if (intent === "pedido_real") {
          const aiOrder = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: `Extrae en formato JSON (sin explicaciones) el siguiente pedido:\nMensaje: \"${combinedMessage}\"\nDebe tener las claves: firstName, lastName, nit (opcional), product y quantity.`
              }
            ]
          });

          let content = aiOrder.choices[0].message.content;
          content = content.replace(/```json\n?/, "").replace(/\n?```/, "").trim();

          let orderData;
          try {
            orderData = JSON.parse(content);
          } catch (parseError) {
            return await sendWAHAMessage(userPhoneNumber, "No pude entender tu pedido. Asegúrate de enviarlo en el formato correcto.");
          }

          if (!orderData.firstName || !orderData.lastName || !orderData.product || !orderData.quantity) {
            return await sendWAHAMessage(userPhoneNumber, "Faltan datos en el pedido. Por favor incluye nombre, producto y cantidad.");
          }

          await prisma.order.create({
            data: {
              phoneNumber: userPhoneNumber,
              name: orderData.firstName,
              lastName: orderData.lastName,
              nit: orderData.nit || null,
              product: orderData.product,
              quantity: parseInt(orderData.quantity, 10)
            },
          });

          await sendWAHAMessage(userPhoneNumber, `✅ Pedido registrado:\n👤 Cliente: ${orderData.firstName} ${orderData.lastName}\n📌 Producto: ${orderData.product}\n🔢 Cantidad: ${orderData.quantity}`);

        } else {
          await openai.beta.threads.messages.create(conversation.threadId, {
            role: "user",
            content: finalMessageForAI,
          });

          let run = await openai.beta.threads.runs.create(conversation.threadId, {
            assistant_id: "asst_UFGyAkWkTwdknKwF7PEsZOod",
          });

          run = await handleRun(conversation.threadId, run.id);

          if (run.status === "completed") {
            const threadMessages = await openai.beta.threads.messages.list(conversation.threadId);
            const aiMessage = extractAssistantMessage(threadMessages);

            await prisma.userMessage.create({
              data: {
                conversationId: conversation.id,
                role: "assistant",
                content: aiMessage,
              },
            });

            await sendWAHAMessage(userPhoneNumber, aiMessage);
          }
        }

        delete messageQueue[userPhoneNumber];
      } catch (err) {
        console.error("❌ Error procesando cola de mensajes:", err);
      }
    }, MESSAGE_DELAY_MS);

    res.status(200).send("Mensaje recibido y en espera para procesar.");
  } catch (error) {
    console.error("❌ Error general en chatHandler:", error);
    next(error);
  }
};

module.exports = {
  chatHandler,
  // Otros exports que tengas
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

// Función para actualizar las etiquetas de todas las conversaciones
async function updateConversationLabels() {
  // Recuperar todas las conversaciones
  const conversations = await prisma.userConversation.findMany();
  const results = [];

  // Recorrer cada conversación
  for (const conv of conversations) {
    // Obtener los mensajes asociados a la conversación
    const messagesRecords = await prisma.userMessage.findMany({
      where: { conversationId: conv.id },
    });
    // Concatenar el contenido de todos los mensajes
    const messagesText = messagesRecords.map(m => m.content).join(" ");

    // Construir el prompt para clasificar
    const prompt = `
Eres un asistente que clasifica conversaciones.
Basado en el siguiente historial, clasifica al cliente como:
- "comprador" si muestra intención de comprar,
- "interesado" si solo muestra interés,
- "indeterminado" en otro caso.
Historial: ${messagesText}
Responde solo con una de las palabras: comprador, interesado, indeterminado.
    `;

    // Llamar a OpenAI para obtener la clasificación
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "Eres un asistente que clasifica conversaciones." },
        { role: "user", content: prompt }
      ],
      max_tokens: 10,
    });
    const classification = response.choices[0]?.message?.content?.trim().toLowerCase();

    // Determinar la etiqueta a asignar (si no es "comprador" ni "interesado", se marcará como "indeterminado")
    let label = "indeterminado";
    if (classification === "comprador" || classification === "interesado") {
      label = classification;
    }

    // Actualizar la conversación en la base de datos con la etiqueta
    await prisma.userConversation.update({
      where: { id: conv.id },
      data: { label: label },
    });

    results.push({ conversationId: conv.id, label: label });
  }
  return results;
}

// Endpoint en el router del chatbot para actualizar etiquetas
chatbotRoutes.post('/label', async (req, res, next) => {
  try {
    const result = await updateConversationLabels();
    res.json({ message: "Etiquetas actualizadas", result });
  } catch (error) {
    next(error);
  }
});

chatbotRoutes.post("/send-message", async (req, res) => {
  try {
    const { phoneNumber, message, mediaUrl } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: "Faltan datos en la solicitud." });
    }

    console.log(`📤 Enviando mensaje a ${phoneNumber}: ${message}`);

    // Enviar el mensaje por WAHA
    await sendWAHAMessage(phoneNumber, message, mediaUrl);

    return res.status(200).json({ success: true, message: "Mensaje enviado correctamente." });
  } catch (error) {
    console.error("❌ Error al enviar mensaje:", error);
    res.status(500).json({ error: "Error al enviar el mensaje." });
  }
});



module.exports = {
  chatbotRoutes,
  analyzeAndTagClients,
  sendPromotionalMessage,
};
