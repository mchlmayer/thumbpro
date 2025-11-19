import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// MODELO DE CRIAÇÃO DE IMAGEM (Estável)
const IMAGE_MODEL = 'imagen-3.0-generate-001'; 

// Helper para esperar (delay)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Tenta executar uma operação. Se der erro de Quota (429), espera e tenta de novo.
 */
async function withRetry<T>(operation: () => Promise<T>, retries = 2, initialDelay = 60000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const errorMessage = error.message || JSON.stringify(error);
        
        // Verifica se é erro de Quota/Limite
        if (retries > 0 && (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('Quota'))) {
            console.warn(`⚠️ Cota atingida. O Google pediu uma pausa. Aguardando ${initialDelay/1000} segundos...`);
            await wait(initialDelay);
            return withRetry(operation, retries - 1, initialDelay);
        }
        throw error;
    }
}

/**
 * Gera imagem apenas com texto
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  return withRetry(async () => {
      try {
        console.log(`Gerando imagem com Texto (Imagen 3.0)...`);

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
        throw error; 
      }
  });
};

/**
 * Função interna para tentar descrever a imagem com múltiplos modelos (Fallback)
 */
async function describeImageWithFallback(imageParts: any[], prompt: string): Promise<string> {
    // Lista de modelos para tentar (do mais rápido para o mais potente)
    const visionModels = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro-vision'];

    for (const model of visionModels) {
        try {
            console.log(`Tentando descrever imagem com modelo: ${model}`);
            const response = await ai.models.generateContent({
                model: model,
                contents: { parts: [...imageParts, { text: prompt }] }
            });
            
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return text;
            
        } catch (error: any) {
            console.warn(`Falha ao usar modelo ${model}:`, error.message);
            // Se for erro de cota, não adianta trocar de modelo imediatamente, melhor esperar no retry externo
            if (error.message?.includes('429') || error.message?.includes('RESOURCE')) throw error;
            // Se for outro erro (404, etc), continua o loop para o próximo modelo
            continue;
        }
    }
    throw new Error("Não foi possível processar a imagem de referência com nenhum modelo disponível.");
}

/**
 * Fluxo Inteligente (Ler -> Criar)
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    return withRetry(async () => {
        try {
            console.log("Iniciando fluxo de Referência...");
            
            const descriptionPrompt = "Describe this image in detail, mainly the style and subject.";
            
            const imageParts = images.map(image => ({
                inlineData: { data: image.data, mimeType: image.mimeType },
            }));

            // Tenta obter a descrição usando o sistema de fallback
            const imageDescription = await describeImageWithFallback(imageParts, descriptionPrompt);
            console.log("Descrição obtida com sucesso.");

            const finalPrompt = `
            Create a YouTube thumbnail.
            Reference Style/Content: ${imageDescription}
            User Changes/Instruction: ${prompt}
            Ensure high quality, photorealistic, 8k.
            `;

            // Usa a função de texto (que já usa o Imagen 3.0) para gerar a final
            // Chamamos direto a API aqui para evitar aninhamento de retries desnecessário
             const response = await ai.models.generateImages({
                model: IMAGE_MODEL,
                prompt: finalPrompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/png',
                    aspectRatio: aspectRatio,
                    safetyFilterLevel: 'block_only_high',
                },
            });

            if (!response.generatedImages?.[0]?.image?.imageBytes) {
                throw new Error("A API retornou vazio na etapa final.");
            }

            return response.generatedImages[0].image.imageBytes;

        } catch (error) {
            console.error("Erro no fluxo de Referência:", error);
            throw error;
        }
    });
};
