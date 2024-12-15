const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const chatbotRoutes = require('./routes/chatbot'); 

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
const { analyzeAndTagClients } = require('./routes/chatbot');

// Programar la tarea para que se ejecute a las 3 AM todos los días
cron.schedule('*/2 * * * *', async () => {
    console.log("Ejecutando análisis y etiquetado cada 2 minutos...");
    await analyzeAndTagClients();
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
