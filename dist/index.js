const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const openai = require('./routes/openai'); // API de OpenAI
const { chatbotRoutes, analyzeAndTagClients, sendPromotionalMessage } = require('./routes/chatbot');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); // Inicializa Prisma
dotenv.config();

const app = express();

// Middleware de seguridad
app.use(helmet());

// Middleware para habilitar CORS
app.use(cors());

// Middleware para registrar las solicitudes HTTP
app.use(morgan('dev')); // Formato 'dev' para logs detallados

// Middleware para comprimir las respuestas
app.use(compression());

// Middleware para limitar las solicitudes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limita a 100 solicitudes por IP
});
app.use(limiter);

// Middleware para analizar JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para registrar todas las solicitudes y respuestas
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

const cron = require('node-cron');

// Programar la tarea para verificar los tags de clientes cada 24 horas (3 AM todos los días)
cron.schedule('0 3 * * *', async () => {
    console.log("Ejecutando análisis y etiquetado cada 24 horas...");
    await analyzeAndTagClients(); // Analiza y etiqueta los clientes según las conversaciones
});

// Programar la tarea para enviar mensajes promocionales cada 36 horas
cron.schedule('0 */36 * * *', async () => {
    console.log("Enviando mensajes promocionales a clientes interesados...");

    try {
        // Buscar clientes interesados en la base de datos
        const interestedClients = await prisma.thread.findMany({
            where: {
                tags: {
                    has: "interesado", // Verifica clientes con la etiqueta "interesado"
                },
            },
        });

        console.log(`Clientes interesados encontrados: ${interestedClients.length}`);

        for (const client of interestedClients) {
            // Obtener los mensajes del asistente para este thread
            const assistantResponse = await openai.beta.threads.messages.list(client.threadId);

            // Extraer el último mensaje del asistente
            const lastAssistantMessage = assistantResponse.data
                .filter((msg) => msg.role === "assistant")
                .pop()?.content;

            // Construir el mensaje promocional
            const promotionalMessage = `
Hola, seguimos teniendo ofertas en base a tu interés:
${typeof lastAssistantMessage === "string" ? lastAssistantMessage : "¡Tenemos increíbles ofertas para ti! Contáctanos para más información."}
¡Esperamos poder ayudarte pronto!
`;

            console.log(`Enviando mensaje promocional a ${client.phoneNumber}:`, promotionalMessage);

            // Enviar mensaje al cliente
            await sendPromotionalMessage(client.phoneNumber, promotionalMessage);
        }
    } catch (error) {
        console.error("Error enviando mensajes promocionales:", error);
    }
});


// Usar las rutas del chatbot
app.use('/api/chatbot', chatbotRoutes);

// Middleware para capturar errores en rutas del chatbot
app.use('/api/chatbot', (err, req, res, next) => {
    console.error('Error en las rutas del chatbot:', {
        message: err.message,
        stack: err.stack,
        route: req.originalUrl,
    });
    next(err); // Pasa el error al manejador global
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
    console.error('Error detectado:', {
        message: err.message,
        stack: err.stack,
        status: err.status || 500,
        route: req.originalUrl,
    });

    res.status(err.status || 500).json({
        message: err.message || '¡Algo salió mal!',
        error: process.env.NODE_ENV === 'development' ? err : {}, // Muestra detalles solo en desarrollo
    });
});

// Manejadores globales para excepciones y promesas no manejadas
process.on('uncaughtException', (err) => {
    console.error('Excepción no controlada:', err);
    process.exit(1); // Opcional: Finaliza el proceso en caso de errores fatales
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa no manejada:', {
        promise,
        reason,
    });
});

// Configuración del puerto
const PORT = process.env.PORT || 4000;

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`El servidor está corriendo en el puerto ${PORT}`);
});
