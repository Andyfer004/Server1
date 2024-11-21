"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// api/index.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan")); // Para el registro de solicitudes
const compression_1 = __importDefault(require("compression"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const chatbot_1 = __importDefault(require("./routes/chatbot"));
const app = (0, express_1.default)();
// Middleware de seguridad
app.use((0, helmet_1.default)());
// Middleware para habilitar CORS
app.use((0, cors_1.default)());
// Middleware para registrar las solicitudes HTTP
app.use((0, morgan_1.default)('combined'));
// Middleware para comprimir las respuestas
app.use((0, compression_1.default)());
// Middleware para limitar las solicitudes
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limita a 100 solicitudes por IP
});
app.use(limiter);
// Middleware para analizar JSON
app.use(express_1.default.json());
// Usar las rutas del chatbot
app.use("/chatbot", chatbot_1.default);
// Middleware para manejo de errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('¡Algo salió mal!');
});
// Configuración del puerto
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
app.listen(PORT, () => {
    console.log(`El servidor está corriendo en el puerto ${PORT}`);
});
