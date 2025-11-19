import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Configuração dos Modelos
const IMAGE_MODEL = 'imagen-3.0-generate-001'; // Modelo para CRIAR imagens (mais estável)
const VISION_MODEL = 'gemini-1.5-flash';       // Modelo para LER imagens e texto (rápido)

/**
 * Gera imagem apenas com texto usando Imagen 3.0
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  try {
    console.log(`Gerando imagem com Texto (Imagen 3.0) [Ratio: ${aspectRatio}]`);

    const response = await ai.models.generateImages({
      model: IMAGE_MODEL,
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/png',
        aspectRatio: aspectRatio,
        safetyFilterLevel: 'block_only_high',
      },
    });

    // Validação robusta da resposta
    if (!response.generatedImages?.[0]?.image?.imageBytes) {
        throw new Error("A API não retornou os dados da imagem.");
    }

    return response.generatedImages[0].image.imageBytes;

  } catch (error) {
    console.error("Erro no Imagen 3.0:", error);
    return handleApiError(error);
  }
};

/**
 * Fluxo Inteligente:
 * 1. Usa Gemini Flash para descrever a imagem de referência.
 * 2. Usa Imagen 3.0 para gerar uma nova imagem baseada na descrição + prompt do usuário.
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    try {
        console.log("Iniciando fluxo de Referência (Ler -> Criar)...");
        
        // Passo 1: Descrever a imagem de referência (Engenharia de Prompt Reversa)
        const descriptionPrompt = "Describe this image in extreme detail, focusing on the lighting, style, composition, and main subject. Be concise.";
        
        const imageParts = images.map(image => ({
            inlineData: { data: image.data, mimeType: image.mimeType },
        }));

        // Chama o modelo de texto para "ver" a imagem
        const descriptionResponse = await ai.models.generateContent({
            model: VISION_MODEL,
            contents: { parts: [...imageParts, { text: descriptionPrompt }] }
        });

        const imageDescription = descriptionResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
        console.log("Descrição da referência gerada:", imageDescription.slice(0, 50) + "...");

        // Passo 2: Criar a nova imagem combinando a descrição visual com o pedido do usuário
        const finalPrompt = `
           Create a YouTube thumbnail.
           Reference Style/Content: ${imageDescription}
           User Changes/Instruction: ${prompt}
           Ensure high quality, photorealistic, 8k.
        `;

        // Chama o modelo de imagem
        return await generateImageWithText(finalPrompt, aspectRatio);

    } catch (error) {
        console.error("Erro no fluxo de Referência:", error);
        return handleApiError(error);
    }
};

// Helper para tratar erros comuns
function handleApiError(error: any): never {
    if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            throw new Error("Limite de requisições atingido (Quota). Aguarde 1 minuto e tente novamente.");
        }
        if (error.message.includes('400') || error.message.includes('INVALID_ARGUMENT')) {
             // Fallback silencioso se o modelo específico falhar, tenta mensagem genérica
             throw new Error("Erro de compatibilidade com o modelo. Tente um prompt mais simples.");
        }
        throw error;
    }
    throw new Error("Erro desconhecido na geração.");
}
