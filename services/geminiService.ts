import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// CONFIGURAÇÃO DE MODELOS
const IMAGE_MODEL = 'imagen-3.0-generate-001'; 
const VISION_MODEL = 'gemini-2.0-flash-exp';   

// Helper para esperar (delay)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Função mágica que tenta rodar o comando várias vezes se der erro de Quota
 */
async function withRetry<T>(operation: () => Promise<T>, retries = 3, initialDelay = 10000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        // Se for erro de Quota (429) e ainda tivermos tentativas
        if (retries > 0 && (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Quota'))) {
            console.warn(`Cota atingida. Aguardando ${initialDelay/1000} segundos para tentar de novo... (${retries} restantes)`);
            // Espera o tempo determinado
            await wait(initialDelay);
            // Tenta de novo com um tempo de espera maior (Exponential Backoff)
            return withRetry(operation, retries - 1, initialDelay + 5000);
        }
        throw error;
    }
}

/**
 * Gera imagem apenas com texto (com Retry)
 */
export const generateImageWithText = async (
    prompt: string, 
    aspectRatio: string = '16:9'
): Promise<string> => {
  // Envolvemos a chamada na função withRetry
  return withRetry(async () => {
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
        // Relança o erro para o withRetry pegar
        throw error; 
      }
  });
};

/**
 * Fluxo Inteligente (Ler -> Criar) (com Retry)
 */
export const generateImageWithReference = async (
    prompt: string, 
    images: Array<{ data: string; mimeType: string }>,
    aspectRatio: string = '16:9'
): Promise<string> => {
    // Aqui também usamos retry, pois a leitura da imagem também consome quota
    return withRetry(async () => {
        try {
            console.log("Iniciando fluxo de Referência (Ler -> Criar)...");
            
            const descriptionPrompt = "Describe this image in extreme detail, focusing on the lighting, style, composition, and main subject. Be concise.";
            
            const imageParts = images.map(image => ({
                inlineData: { data: image.data, mimeType: image.mimeType },
            }));

            // Passo 1: Ler a imagem (Flash 2.0)
            const descriptionResponse = await ai.models.generateContent({
                model: VISION_MODEL,
                contents: { parts: [...imageParts, { text: descriptionPrompt }] }
            });

            const imageDescription = descriptionResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
            console.log("Descrição gerada com sucesso.");

            // Passo 2: Criar a imagem (Imagen 3.0)
            // Chamamos a função de texto que já tem seu próprio retry, 
            // mas para garantir, chamamos a lógica direta aqui para evitar duplo wrap desnecessário ou erros de contexto
            
            const finalPrompt = `
            Create a YouTube thumbnail.
            Reference Style/Content: ${imageDescription}
            User Changes/Instruction: ${prompt}
            Ensure high quality, photorealistic, 8k.
            `;

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
                throw new Error("A API não retornou os dados da imagem.");
            }

            return response.generatedImages[0].image.imageBytes;

        } catch (error) {
            console.error("Erro no fluxo de Referência:", error);
            throw error;
        }
    });
};
