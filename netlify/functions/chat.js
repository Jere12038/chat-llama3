// netlify/functions/chat.js
 
export default async (request, context) => {
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }
 
    try {
        const body = await request.json();
        const messages  = body.messages;
        const providedKey = body.access_key;
        const fileBase64  = body.file_base64;
        const fileMime    = body.file_mime;
        const fileName    = body.file_name;
        const fileText    = body.file_text; // texto pre-extraído por el frontend (PDFs)
 
        // 1. VERIFICACIÓN DE ACCESO
        const SECURE_KEY = process.env.CHAT_ACCESS_KEY;
        if (!SECURE_KEY || providedKey !== SECURE_KEY) {
            return new Response(JSON.stringify({ error: "Acceso no autorizado. Clave incorrecta." }), { status: 401 });
        }
 
        if (!messages || messages.length === 0) {
            return new Response(JSON.stringify({ error: "No se proporcionaron mensajes." }), { status: 400 });
        }
 
        const GROQ_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_KEY) {
            return new Response(JSON.stringify({ error: "ERROR: GROQ_API_KEY no configurada." }), { status: 500 });
        }
 
        // 2. CONSTRUIR EL ÚLTIMO MENSAJE CON EL ARCHIVO
        let finalMessages = [...messages];
        const lastMsg = finalMessages[finalMessages.length - 1];
 
        // Limpiar el tag visual que añade el frontend
        const cleanContent = (lastMsg.content || "").replace(/\[?📎[^\]]*\]?/g, "").trim();
 
        const isImage = fileBase64 && fileMime && fileMime.startsWith("image/");
 
        if (isImage) {
            // IMAGEN: Groq Vision con llama-4
            lastMsg.content = [
                {
                    type: "image_url",
                    image_url: { url: `data:${fileMime};base64,${fileBase64}` }
                },
                {
                    type: "text",
                    text: cleanContent || "Extrae y transcribe todo el texto que aparece en esta imagen. Si no hay texto, describe la imagen detalladamente."
                }
            ];
        } else if (fileText) {
            // PDF u otro: el frontend ya extrajo el texto
            lastMsg.content = `[TEXTO EXTRAÍDO DE: ${fileName}]\n---\n${fileText}\n---\n\n${cleanContent || "Resume o analiza el texto anterior."}`;
        } else {
            lastMsg.content = cleanContent || lastMsg.content;
        }
 
        // 3. ENVIAR A GROQ
        const fullMessages = [
            {
                role: "system",
                content: "Eres un asistente útil y conciso. Responde siempre en español. Si se te proporciona texto extraído de un documento o imagen, úsalo como base para responder la consulta del usuario."
            },
            ...finalMessages
        ];
 
        const apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: isImage ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.1-8b-instant",
                messages: fullMessages,
                max_tokens: 2048
            })
        });
 
        if (!apiResponse.ok) {
            const errorData = await apiResponse.json();
            const errorMessage = errorData.error?.message || "Error desconocido de Groq.";
            return new Response(JSON.stringify({ error: `ERROR Groq (${apiResponse.status}): ${errorMessage}` }), { status: apiResponse.status });
        }
 
        const data = await apiResponse.json();
        const reply = data.choices?.[0]?.message?.content;
 
        if (!reply) {
            return new Response(JSON.stringify({ error: "Error: respuesta vacía de la IA." }), { status: 500 });
        }
 
        return new Response(JSON.stringify({ reply }), {
            headers: { "Content-Type": "application/json" }
        });
 
    } catch (error) {
        console.error("Backend Error:", error.message);
        return new Response(JSON.stringify({ error: `Error interno: ${error.message}` }), { status: 500 });
    }
};
