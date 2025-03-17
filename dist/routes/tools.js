"use strict";
const openai = require("./openai"); 
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tools = exports.similarProducts = exports.catalogProducts = exports.deliveryStatus = void 0;
// api/routes/tools.ts
const axios_1 = __importDefault(require("axios"));
const openai_1 = __importDefault(require("./openai"));
//const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
//const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = "17d985-b1.myshopify.com";
const SHOPIFY_ACCESS_TOKEN = "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";
const STOREFRONT_ACCESS_TOKEN = "b89bb9aa419251fa3f4fa465c1b9f605";
const SHOPIFY_STOREFRONT_DOMAIN = "17d985-b1.myshopify.com";
const shopifyRequest = axios_1.default.create({
    baseURL: `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-01`,
    headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    },
});
const deliveryStatus = async (orderNumber) => {
    try {
        // Realiza la solicitud a la API de Shopify
        const response = await shopifyRequest.get(`/orders.json`, {
            params: {
                status: 'any', // Puedes agregar otros parámetros si es necesario
            },
        });
        // Accede al arreglo de órdenes
        const orders = response.data.orders;
        // Convierte el orderNumber de string a número
        const orderNum = parseInt(orderNumber, 10);
        // Valida si la conversión fue exitosa
        if (isNaN(orderNum)) {
            return "El número de orden proporcionado no es válido.";
        }
        // Busca la orden que coincide con el order_number proporcionado
        const order = orders.find((o) => o.order_number === orderNum);
        // Si no se encuentra la orden, devuelve un mensaje de error
        if (!order) {
            return "No se encontró una orden con el número proporcionado.";
        }
        // Devuelve el objeto de la orden encontrada como string
        const responseText = JSON.stringify({
            "Descripción de la orden que corresponde a el número proporcionado: ": order
        });
        return responseText;
    }
    catch (error) {
        console.error("Error al obtener el estado de entrega:", error);
        return "No pudimos obtener el estado de tu entrega, por favor intenta más tarde.";
    }
};
exports.deliveryStatus = deliveryStatus;
const catalogProducts = async () => {
    try {
        const response = await shopifyRequest.get("/products.json");
        const products = response.data.products;
        //console.log("Catalogo =====================================> ", products)
        const responseText = JSON.stringify(products);
        return responseText;
    }
    catch (error) {
        console.error("Error al verificar el catálogo:", error);
        return "No pudimos verificar el catálogo, por favor intenta más tarde.";
    }
};
exports.catalogProducts = catalogProducts;
const similarProducts = async (imageUrl) => {
    try {
        // Paso 1: Utilizar OpenAI para obtener una descripción detallada de la imagen
        const aiResponse = await openai_1.default.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe detalladamente el contenido de esta imagen." },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl,
                            },
                        },
                    ],
                },
            ],
        });
        // Extraer la descripción de la respuesta de OpenAI
        const description = aiResponse.choices[0].message.content.trim();
        //console.log("Descripción de la imagen:", description);
        // Paso 2: Obtener la lista de productos de Shopify
        const response = await shopifyRequest.get("/products.json");
        const products = response.data.products;
        const responseText = JSON.stringify({
            "Descripción de la imagen recibida": description,
            "Productos": products,
        });
        //console.log("Imagen ===========================> ", responseText)
        return responseText;
    }
    catch (error) {
        console.error("Error al obtener productos similares:", error);
        throw new Error("No pudimos encontrar productos similares, por favor intenta más tarde.");
    }
};
exports.similarProducts = similarProducts;
const createCheckout = async (lineItems) => {
    const mutation = `
    mutation checkoutCreate($input: CheckoutCreateInput!) {
      checkoutCreate(input: $input) {
        checkout {
          id
          webUrl
        }
        checkoutUserErrors {
          field
          message
        }
      }
    }
  `;
    const variables = {
        input: {
            lineItems: lineItems.map(item => ({
                variantId: item.variantId,
                quantity: item.quantity,
            })),
        },
    };
    try {
        const response = await axios_1.default.post(`https://${SHOPIFY_STOREFRONT_DOMAIN}/api/2023-07/graphql.json`, { query: mutation, variables }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': STOREFRONT_ACCESS_TOKEN,
            },
        });
        const checkout = response.data.data.checkoutCreate.checkout;
        if (!checkout) {
            const errors = response.data.data.checkoutCreate.checkoutUserErrors
                .map((error) => error.message)
                .join(', ');
            throw new Error(`Error al crear el checkout: ${errors}`);
        }
        return `Este es el url donde el usuario puede hacer la compra: ${checkout.webUrl}`;
    }
    catch (error) {
        console.error('Error al crear el checkout:', error);
        throw new Error('No pudimos crear el checkout, por favor intenta más tarde.');
    }
};

async function saveOrder(userPhoneNumber, message) {
    try {
        console.log("📝 Recibido un mensaje de pedido:", message);

        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: `Extrae en formato JSON (sin explicaciones) el siguiente pedido:
Mensaje: "${message}"
Debe tener las claves: firstName, lastName, nit (opcional), product y quantity.
Responde **solo con JSON puro**, sin explicaciones ni texto adicional.`
                }
            ]
        });

        let content = aiResponse.choices[0].message.content;
        console.log("🔍 Respuesta de OpenAI antes de limpiar:", content);

        // **Limpieza de la respuesta** (elimina los ```json y ``` que están alrededor del JSON)
        content = content.replace(/```json\n?/, "").replace(/\n?```/, "").trim();

        console.log("✅ Respuesta limpia de OpenAI:", content);

        let orderData;
        try {
            orderData = JSON.parse(content);
        } catch (parseError) {
            console.error("❌ Error al parsear el JSON extraído:", parseError);
            return "No pude entender tu pedido. Asegúrate de enviarlo en el formato correcto.";
        }

        // **Verificar si los datos se extrajeron correctamente**
        console.log("📦 Datos extraídos del pedido:", orderData);

        if (!orderData.firstName || !orderData.lastName || !orderData.product || !orderData.quantity) {
            console.error("❌ Faltan datos en el pedido extraído:", orderData);
            return "No pude entender tu pedido. Asegúrate de enviarlo en el formato correcto.";
        }

        // **Intentar guardar en la base de datos**
        console.log("📌 Intentando guardar en la base de datos...");

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

        console.log("✅ Pedido guardado exitosamente en la base de datos.");

        return `✅ Pedido registrado:\n👤 Cliente: ${orderData.firstName} ${orderData.lastName}\n📌 Producto: ${orderData.product}\n🔢 Cantidad: ${orderData.quantity}`;
    } catch (error) {
        console.error("🚨 Error al guardar pedido:", error);
        return "Hubo un error al procesar el pedido. Inténtalo nuevamente.";
    }
}


exports.saveOrder = saveOrder;
exports.tools = {
    deliveryStatus: exports.deliveryStatus,
    catalogProducts: exports.catalogProducts,
    similarProducts: exports.similarProducts,
    saveOrder,
    createCheckout
};
