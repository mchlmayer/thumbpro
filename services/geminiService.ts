import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// CONFIGURAÇÃO FINAL DE MODELOS
// 1. Imagen 3.0: O melhor para CRIAR imagens (Estável)
const IMAGE_MODEL = 'imagen-3.0-generate-001'; 
// 2. Gemini 2.0 Flash Exp: O mais rápido para LER/DESCREVER imagens (Sabemos que sua chave acessa este)
const VISION_MODEL = 'gemini-2.0-flash-exp';   

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
 * 1. Usa Gemini 2.0 Flash para descrever a imagem de referência.
 * 2. Usa Imagen 3.0 para gerar uma nova imagem baseada na descrição.
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    try {
        console.log("Iniciando fluxo de Referência (Ler -> Criar)...");
        
        // Passo 1: Descrever a imagem de referência
        const descriptionPrompt = "Describe this image in extreme detail, focusing on the lighting, style, composition, and main subject. Be concise.";
        
        const imageParts = images.map(image => ({
            inlineData: { data: image.data, mimeType: image.mimeType },
        }));

        // Chama o modelo de texto/visão (Flash 2.0)
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

        // Chama o modelo de imagem (Imagen 3.0)
        return await generateImageWithText(finalPrompt, aspectRatio);

    } catch (error) {
        console.error("Erro no fluxo de Referência:", error);
        return handleApiError(error);
    }
};

// Helper para tratar erros comuns
function handleApiError(error: any): never {
    if (error instanceof Error) {
        // Erro de Quota
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            throw new Error("Limite de requisições atingido (Quota). Aguarde 1 minuto e tente novamente.");
        }
        // Erro de Modelo não encontrado
        if (error.message.includes('404') || error.message.includes('not found')) {
             throw new Error(`Erro de modelo (${error.message}). Tente novamente em instantes.`);
        }
        throw error;
    }
    throw new Error("Erro desconhecido na geração.");
}
