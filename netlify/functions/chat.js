// netlify/functions/chat-simple.js

export default async (request, context) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    // AHORA ESPERAMOS UN ARRAY DE MENSAJES PARA DAR MEMORIA
    const messages = body.messages; 

    // Añadir mensaje del sistema para darle contexto y memoria a Llama 3
    const fullMessages = [
      { role: "system", content: "Eres un asistente útil y conciso. Responde en español." },
      ...messages 
    ];

    const apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        // Usa la clave de la variable de entorno de Netlify
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3-8b-8192", 
        messages: fullMessages // ENVIAMOS EL HISTORIAL COMPLETO
      })
    });

    const data = await apiResponse.json();
    const reply = data.choices[0]?.message?.content || "Error en la respuesta de la IA.";

    return new Response(JSON.stringify({ reply: reply }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Backend Error:", error);
    return new Response(JSON.stringify({ error: "Error de procesamiento del servidor." }), { status: 500 });
  }

};
