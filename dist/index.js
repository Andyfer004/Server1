import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import chatbotRoutes from './routes/chatbot'; // Importa las rutas del chatbot

dotenv.config();

const app = express();

// Middleware de seguridad
app.use(helmet());

// Middleware para habilitar CORS
app.use(cors());

// Middleware para registrar las solicitudes HTTP
app.use(morgan('combined'));

// Middleware para comprimir las respuestas
app.use(compression());

// Middleware para limitar las solicitudes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limita a 100 solicitudes por IP
});
app.use(limiter);

// Middleware para analizar JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Usar las rutas del chatbot
app.use('/api/chatbot', chatbotRoutes);

// Middleware para manejo de errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('¡Algo salió mal!');
});

// Configuración del puerto
const PORT = process.env.PORT || 4000;

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`El servidor está corriendo en el puerto ${PORT}`);
});
