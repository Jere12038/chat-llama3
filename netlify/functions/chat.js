// netlify/functions/chat.js
import { createWorker } from 'tesseract.js';
import { Buffer } from 'buffer'; // Necesario en Node.js para manejar Base64

// Creamos un worker de Tesseract fuera del handler (para reuso)
let worker = null;

// Función de inicialización y carga de lenguajes
async function initializeWorker() {
    if (worker) return; // Si ya existe, no inicializamos de nuevo

    worker = await createWorker({
        // Si no se usa logger, Netlify no lo registrará.
        // logger: m => console.log(m) 
    });
    
    // Soporte para inglés y español (los paquetes de datos se descargan automáticamente)
    await worker.loadLanguage('eng+spa'); 
    await worker.initialize('eng+spa');
}


export default async (request, context) => {
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const body = await request.json();
        const messages = body.messages;
        const providedKey = body.access_key;
        const imageBase64 = body.image_base64; // <--- OBTENEMOS LA IMAGEN BASE64

        // 1. VERIFICACIÓN DE ACCESO
        const SECURE_KEY = process.env.CHAT_ACCESS_KEY;
        if (!SECURE_KEY || providedKey !== SECURE_KEY) {
            return new Response(JSON.stringify({ error: "Acceso no autorizado. Clave incorrecta." }), { status: 401 });
        }

        if (!messages || messages.length === 0) {
            return new Response(JSON.stringify({ error: "No se proporcionaron mensajes." }), { status: 400 });
        }

        // 2. PROCESAMIENTO OCR (Si hay imagen)
        let ocrText = "";
        let finalMessages = messages;

        if (imageBase64) {
            await initializeWorker();
            
            // Tesseract necesita un Buffer para procesar la data Base64
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            
            const { data: { text } } = await worker.recognize(imageBuffer);
            ocrText = text.trim();

            if (!ocrText) {
                // Si el OCR falla, creamos una respuesta de error para el usuario
                const errorMessage = "Error de OCR: No se pudo extraer texto claro de la imagen. Por favor, prueba con una imagen de mejor calidad.";
                // Inyectamos el error como la respuesta del bot para que el frontend lo muestre
                 return new Response(JSON.stringify({ reply: `[ATENCIÓN] ${errorMessage}` }), { status: 200 });
            }
            
            // 3. INYECTAR TEXTO OCR EN EL PROMPT
            const lastUserMessage = messages[messages.length - 1];
            
            // Reemplazamos la etiqueta [ATTACHMENT: nombre] del frontend con el texto OCR
            lastUserMessage.content = lastUserMessage.content.replace(/\[ATTACHMENT:.*?\]/, "");
            lastUserMessage.content = `[CONTEXTO DE IMAGEN] El usuario ha adjuntado una imagen con el siguiente texto extraído:\n---\n${ocrText}\n---\n\nINSTRUCCIONES DEL USUARIO: ${lastUserMessage.content}`;
            
            finalMessages = messages;
        }

        // 4. PREPARAR Y ENVIAR A GROQ
        const GROQ_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_KEY) {
          return new Response(JSON.stringify({ error: "ERROR: La clave secreta GROQ_API_KEY no fue cargada por el servidor." }), { status: 500 });
        }

        const fullMessages = [
          { role: "system", content: "Eres un asistente útil y conciso. Responde en español. Si se te proporciona un texto extraído de una imagen, usa ese texto como base para responder la consulta del usuario, traduciendo o resumiendo según se te solicite." },
          ...finalMessages // Usamos los mensajes con el OCR inyectado
        ];

        const apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
             method: "POST",
             headers: {
                "Authorization": `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json"
             },
             body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: fullMessages
             })
        });

        // 5. MANEJO DE RESPUESTA Y ERRORES DE GROQ
        if (!apiResponse.ok) {
            const errorData = await apiResponse.json();
            const errorMessage = errorData.error?.message || "Error desconocido de la API de Groq.";
            return new Response(JSON.stringify({ error: `ERROR API Groq (${apiResponse.status}): ${errorMessage}` }), { status: apiResponse.status });
        }

        const data = await apiResponse.json();
        const reply = data.choices?.[0]?.message?.content; 

        if (!reply) {
            return new Response(JSON.stringify({ error: "Error: No se encontró la respuesta de la IA en el formato esperado." }), { status: 500 });
        }

        return new Response(JSON.stringify({ reply: reply }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        // El error puede venir de Tesseract o de la red.
        console.error("Backend Catch Error:", error.message);
        return new Response(JSON.stringify({ error: `Error de procesamiento interno (Tesseract o servidor): ${error.message}` }), { status: 500 });
    }
};
