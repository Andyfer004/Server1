import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatbotRoutes from './routes/chatbot'; // Importa las rutas del chatbot

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// Rutas
app.use('/api/chatbot', chatbotRoutes); // Asocia las rutas del chatbot con el endpoint '/api/chatbot'

// Configuración del puerto
const PORT = process.env.PORT || 4000;

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`El servidor está corriendo en el puerto ${PORT}`);
});
