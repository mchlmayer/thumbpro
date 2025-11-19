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
 * Tenta descrever a imagem usando vários modelos diferentes até um funcionar.
 */
async function describeImageWithFallback(imageParts: any[], prompt: string): Promise<string> {
    // Lista de modelos para tentar, do mais novo para o mais antigo
    // Removemos o 2.0-exp pois sua conta não tem acesso
    const visionModels = [
        'gemini-1.5-flash',       // Padrão rápido
        'gemini-1.5-flash-latest',// Alternativa do rápido
        'gemini-1.5-pro',         // Mais potente (mas mais lento)
        'gemini-pro-vision'       // Legado (último recurso)
    ];

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
            const msg = error.message || '';
            console.warn(`Falha ao usar modelo ${model}:`, msg);
            
            // Se o erro for 'limit: 0' (sem acesso), pula imediatamente para o próximo modelo
            if (msg.includes('limit: 0') || msg.includes('not found') || msg.includes('404')) {
                continue; 
            }
            
            // Se for cota temporária (429 mas com limite > 0), lança o erro para o retry externo esperar
            if (msg.includes('429') || msg.includes('RESOURCE')) {
                throw error;
            }
            // Tenta o próximo modelo da lista
            continue;
        }
    }
    throw new Error("Não foi possível ler a imagem de referência. Sua conta parece não ter acesso aos modelos de visão atuais.");
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

            // Aqui usamos a nova função robusta que tenta vários modelos
            const imageDescription = await describeImageWithFallback(imageParts, descriptionPrompt);
            console.log("Descrição obtida com sucesso.");

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
                throw new Error("A API retornou vazio na etapa final.");
            }

            return response.generatedImages[0].image.imageBytes;

        } catch (error) {
            console.error("Erro no fluxo de Referência:", error);
            throw error;
        }
    });
};
