# Usa una imagen base con Node.js
FROM node:18

# Crea un directorio de trabajo
WORKDIR /app

# Copia package.json y lockfiles primero para aprovechar el cacheo de Docker
COPY package*.json ./

# Copia la carpeta prisma
COPY prisma ./prisma

# Instala las dependencias
RUN yarn install

# Copia el resto de los archivos del proyecto
COPY . .

# Exponer el puerto en el que escucha tu aplicación
EXPOSE 8080

# Comando para iniciar la aplicación
CMD ["node", "dist/index.js"]
