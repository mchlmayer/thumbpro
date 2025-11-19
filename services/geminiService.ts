import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// CORREÇÃO: O nome correto do modelo rápido que gera imagens é gemini-2.0-flash-exp
const MODEL_NAME = 'gemini-2.0-flash-exp'; 

/**
 * Helper para extrair a imagem base64 da resposta do Gemini
 */
const extractImageFromCandidate = (response: any): string => {
    const candidate = response.candidates?.[0];

    if (!candidate || !candidate.content || !candidate.content.parts) {
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
            if (['SAFETY', 'BLOCK', 'PROHIBITED_CONTENT'].includes(candidate.finishReason)) {
                throw new Error("A imagem foi bloqueada pelo filtro de segurança. Tente um prompt mais leve.");
            }
            throw new Error(`Geração interrompida: ${candidate.finishReason}`);
        }
        throw new Error("A API não retornou conteúdo válido.");
    }

    for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
            return part.inlineData.data;
        }
    }

    throw new Error("Nenhuma imagem foi encontrada na resposta da IA.");
};

/**
 * Gera uma imagem a partir de texto usando Gemini 2.0 Flash.
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  try {
    console.log(`Gerando imagem (Gemini 2.0 Flash) [Ratio: ${aspectRatio}]:`, prompt);

    const enhancedPrompt = `Create a high-quality youtube thumbnail: ${prompt}. Aspect Ratio: ${aspectRatio}. Photorealistic, 8k, detailed.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts: [{ text: enhancedPrompt }] },
      config: {
        responseModalities: [Modality.IMAGE], 
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ],
      },
    });

    return extractImageFromCandidate(response);

  } catch (error) {
    console.error("Erro no Gemini 2.0 Flash:", error);
    if (error instanceof Error) {
        // Se o modelo experimental não for encontrado (404), avisamos o usuário
        if (error.message.includes('404') || error.message.includes('not found')) {
             throw new Error("O modelo Gemini 2.0 Flash ainda não está disponível para sua chave. Tente usar o Imagen.");
        }
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
          throw new Error("Limite de requisições atingido (Quota). Aguarde alguns instantes.");
        }
        throw error;
    }
    throw new Error("Erro desconhecido ao gerar imagem.");
  }
};

/**
 * Edita ou gera baseada em referência usando Gemini 2.0 Flash.
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    try {
        const enhancedPrompt = `
STRICT INSTRUCTION: Follow the user prompt applied to the reference image.
User Prompt: "${prompt}"
Output Aspect Ratio: ${aspectRatio}
Ensure high quality and photorealism.
`;

        console.log(`Gerando com referência (Gemini 2.0 Flash) [Ratio: ${aspectRatio}]`);

        const imageParts = images.map(image => ({
            inlineData: {
                data: image.data,
                mimeType: image.mimeType,
            },
        }));

        const response = await ai.models.generateContent({
            model: MODEL_NAME, 
            contents: { parts: [ ...imageParts, { text: enhancedPrompt } ] },
            config: {
                responseModalities: [Modality.IMAGE],
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                ],
            },
        });

        return extractImageFromCandidate(response);

    } catch (error) {
        console.error("Erro no Gemini 2.0 Flash (Referência):", error);
        if (error instanceof Error) {
            if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
                throw new Error("Limite de requisições atingido. Aguarde um momento.");
            }
            throw error;
        }
        throw new Error("Erro desconhecido ao processar referência.");
    }
};
