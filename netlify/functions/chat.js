// netlify/functions/chat.js
// Versión más robusta con manejo de errores y clave corregida

export default async (request, context) => {
  if (request.method !== "POST") {
    // Si no es POST, no está permitido
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const messages = body.messages;

    // Verificar si se ha enviado algún mensaje para evitar errores de formato
    if (!messages || messages.length === 0) {
        return new Response(JSON.stringify({ error: "No se proporcionaron mensajes en la solicitud." }), { status: 400 });
    }

    // 1. Usamos process.env para acceder a la clave (SOLUCIÓN al TypeError)
    const GROQ_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_KEY) {
        // Este es el error más probable si la clave no se inyectó
        return new Response(JSON.stringify({ error: "ERROR: La clave secreta GROQ_API_KEY no fue cargada por el servidor. Revisa las variables de entorno de Netlify." }), { status: 500 });
    }

    // Añadir mensaje del sistema para darle contexto y memoria a Llama 3
    const fullMessages = [
      { role: "system", content: "Eres un asistente útil y conciso. Responde en español." },
      ...messages
    ];

    const apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`, // Usamos la clave obtenida
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3-8b-8192", 
        messages: fullMessages
      })
    });
    
    // 2. Manejo de Errores: Verifica si la respuesta de Groq es un error (ej. 401 por clave incorrecta)
    if (!apiResponse.ok) {
        const errorData = await apiResponse.json();
        const errorMessage = errorData.error?.message || "Error desconocido de la API de Groq.";
        
        // Devolvemos un error claro al Frontend
        return new Response(JSON.stringify({ error: `ERROR API Groq (${apiResponse.status}): ${errorMessage}` }), { status: apiResponse.status });
    }

    const data = await apiResponse.json();
    
    // 3. Extracción de la Respuesta (con verificación)
    const reply = data.choices?.[0]?.message?.content; 

    if (!reply) {
        // Si no hay respuesta (pero el status fue OK), puede ser un error de formato de Groq.
        return new Response(JSON.stringify({ error: "Error: No se encontró la respuesta de la IA en el formato esperado." }), { status: 500 });
    }

    return new Response(JSON.stringify({ reply: reply }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Backend Catch Error:", error.message);
    return new Response(JSON.stringify({ error: "Error de procesamiento interno del servidor. Revisa los logs de Netlify." }), { status: 500 });
  }
};
