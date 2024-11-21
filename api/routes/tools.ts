// api/routes/tools.ts
import axios from "axios";
import openai from "./openai";


const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const STOREFRONT_ACCESS_TOKEN= process.env.STOREFRONT_ACCESS_TOKEN
const SHOPIFY_STOREFRONT_DOMAIN= process.env.SHOPIFY_STORE_DOMAIN;


interface Customer {
  id: number;
  email: string;
}

interface LineItem {
  id: number;
  name: string;
  price: string;
  quantity: number;
}

interface Order {
  id: number;
  order_number: number;
  financial_status: string;
  fulfillment_status: string | null;
  customer: Customer;
  line_items: LineItem[];
}

const shopifyRequest = axios.create({
  baseURL: `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-01`,
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
  },
});

export const deliveryStatus = async (orderNumber: string): Promise<string> => {
  try {
    // Realiza la solicitud a la API de Shopify
    const response = await shopifyRequest.get(`/orders.json`, {
      params: {
        status: 'any', 
      },
    });

    // Accede al arreglo de órdenes
    const orders: Order[] = response.data.orders;

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
      "Descripción de la orden que corresponde a el número proporcionado: ": order });

    return responseText;

  } catch (error) {
    console.error("Error al obtener el estado de entrega:", error);
    return "No pudimos obtener el estado de tu entrega, por favor intenta más tarde.";
  }
};

export const catalogProducts = async (): Promise<string> => {
  try {
    const response = await shopifyRequest.get("/products.json");
    const products = response.data.products;

    const responseText = JSON.stringify(products);
    return responseText;
  } catch (error) {
    console.error("Error al verificar el catálogo:", error);
    return "No pudimos verificar el catálogo, por favor intenta más tarde.";
  }
};



export const similarProducts = async (
  imageUrl: string
): Promise<string> => {
  try {
    // Paso 1: Utilizar OpenAI para obtener una descripción detallada de la imagen
    const aiResponse = await openai.chat.completions.create({
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
    const description = aiResponse.choices[0].message.content!.trim();

    // Paso 2: Obtener la lista de productos de Shopify
    const response = await shopifyRequest.get("/products.json");
    const products = response.data.products;

    const responseText = JSON.stringify({
      "Descripción de la imagen recibida": description,
      "Productos": products,
    });

    
    return responseText;
  } catch (error) {
    console.error("Error al obtener productos similares:", error);
    throw new Error("No pudimos encontrar productos similares, por favor intenta más tarde.");
  }
};

const createCheckout = async (lineItems: { variantId: string; quantity: number }[], userFinishedToOrder: boolean): Promise<string> => {
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

  
  if (userFinishedToOrder === false) {
    const responseError = "El usuario aún no ha terminado de ordenar"
    console.log(responseError)
    return responseError
  }

  const variables = {
    input: {
      lineItems: lineItems.map(item => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    },
  };

  try {
    const response = await axios.post(
      `https://${SHOPIFY_STOREFRONT_DOMAIN}/api/2023-07/graphql.json`,
      { query: mutation, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': STOREFRONT_ACCESS_TOKEN,
        },
      }
    );

    const checkout = response.data.data.checkoutCreate.checkout;

    if (!checkout) {
      const errors = response.data.data.checkoutCreate.checkoutUserErrors
        .map((error: any) => error.message)
        .join(', ');
      throw new Error(`Error al crear el checkout: ${errors}`);
    }

    return `Este es el url donde el usuario puede hacer la compra: ${checkout.webUrl}`;
  } catch (error) {
    console.error('Error al crear el checkout:', error);
    throw new Error('No pudimos crear el checkout, por favor intenta más tarde.');
  }
};


export const tools = {
  deliveryStatus,
  catalogProducts,
  similarProducts,
  createCheckout
};
