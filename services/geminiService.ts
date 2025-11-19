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
 * Tenta executar uma operação com Retry automático se der erro de Cota.
 */
async function withRetry<T>(operation: () => Promise<T>, retries = 2, initialDelay = 60000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const errorMessage = error.message || JSON.stringify(error);
        
        // Verifica se é erro de Quota/Limite
        if (retries > 0 && (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('Quota'))) {
            console.warn(`⚠️ Cota atingida. Pausando por ${initialDelay/1000}s...`);
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
 * Tenta descrever a imagem usando uma lista exaustiva de modelos.
 */
async function describeImageWithFallback(imageParts: any[], prompt: string): Promise<string> {
    // LISTA COMPLETA DE MODELOS (Do mais leve/novo para o mais antigo)
    // Se um falhar, ele tenta o próximo.
    const visionModels = [
        'gemini-1.5-flash',         // Padrão atual
        'gemini-1.5-flash-001',     // Versão específica 001
        'gemini-1.5-flash-002',     // Versão específica 002
        'gemini-1.5-flash-8b',      // Versão "Micro" (muito rápida e acessível)
        'gemini-1.5-pro',           // Pro padrão
        'gemini-1.5-pro-001',       // Pro versão 001
        'gemini-1.5-pro-002',       // Pro versão 002
        'gemini-pro-vision'         // Legado (muito estável para contas antigas)
    ];

    let lastError = null;

    for (const model of visionModels) {
        try {
            console.log(`Tentando ler imagem com modelo: ${model}`);
            const response = await ai.models.generateContent({
                model: model,
                contents: { parts: [...imageParts, { text: prompt }] }
            });
            
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
                console.log(`✅ Sucesso com o modelo: ${model}`);
                return text;
            }
            
        } catch (error: any) {
            const msg = error.message || '';
            console.warn(`❌ Falha ao usar modelo ${model}:`, msg);
            lastError = error;
            
            // Se for erro de Cota TEMPORÁRIA (429), não adianta mudar de modelo, tem que esperar.
            // Mas como estamos dentro de um fluxo maior, vamos deixar o loop continuar para ver se outro modelo tem cota livre.
            // (Muitas vezes a cota é por modelo, então mudar de modelo AJUDA).
            continue;
        }
    }
    
    console.error("Todos os modelos de visão falharam.");
    throw new Error(`Não foi possível ler a imagem. Detalhe do último erro: ${lastError?.message}`);
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

            // Chama a função que tenta TODOS os modelos
            const imageDescription = await describeImageWithFallback(imageParts, descriptionPrompt);
            
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
