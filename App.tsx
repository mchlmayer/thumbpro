import React, { useState, useCallback, useRef, useEffect } from 'react';
import { generateImageWithText, generateImageWithReference } from './services/geminiService';
import { Spinner } from './components/Spinner';
import { ImagePlaceholderIcon, ErrorIcon, UploadIcon, RemoveIcon, DownloadIcon } from './components/Icons';

const ASPECT_RATIOS = [
  { label: 'YouTube (16:9)', value: '16:9', width: 1280, height: 720 },
  { label: 'Shorts/TikTok (9:16)', value: '9:16', width: 720, height: 1280 },
  { label: 'Instagram (1:1)', value: '1:1', width: 1024, height: 1024 },
  { label: 'Padrão (4:3)', value: '4:3', width: 1024, height: 768 },
  { label: 'Retrato (3:4)', value: '3:4', width: 768, height: 1024 },
];

interface HistoryItem {
  id: string;
  imageUrl: string;
  prompt: string;
  aspectRatio: string;
  timestamp: number;
}

const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  
  // Armazena o arquivo original para reprocessamento se o aspect ratio mudar
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  
  const [referenceImage, setReferenceImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Histórico de gerações (máximo de 6 itens para economizar memória)
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = generatedImage !== null;

  const getBase64FromDataUrl = (dataUrl: string) => dataUrl.split(',')[1];

  const processFileWithRatio = useCallback((file: File, ratioValue: string) => {
    const ratioConfig = ASPECT_RATIOS.find(r => r.value === ratioValue) || ASPECT_RATIOS[0];
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setError("Não foi possível processar a imagem. O contexto do canvas não está disponível.");
          return;
        }

        const targetWidth = ratioConfig.width;
        const targetHeight = ratioConfig.height;
        const targetAspectRatio = targetWidth / targetHeight;
        
        let srcWidth = img.width;
        let srcHeight = img.height;
        let srcX = 0;
        let srcY = 0;

        const currentAspectRatio = srcWidth / srcHeight;

        // Calculate cropping dimensions to center crop based on selected ratio
        if (currentAspectRatio > targetAspectRatio) {
          // Image is wider than target, crop the sides
          srcWidth = srcHeight * targetAspectRatio;
          srcX = (img.width - srcWidth) / 2;
        } else if (currentAspectRatio < targetAspectRatio) {
          // Image is taller than target, crop the top and bottom
          srcHeight = srcWidth / targetAspectRatio;
          srcY = (img.height - srcHeight) / 2;
        }
        
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        
        ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, canvas.width, canvas.height);

        const croppedMimeType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        const croppedDataUrl = canvas.toDataURL(croppedMimeType, 0.95);
        
        setReferenceImagePreview(croppedDataUrl);
        setReferenceImage({
          data: getBase64FromDataUrl(croppedDataUrl),
          mimeType: croppedMimeType,
        });
      };
      img.onerror = () => {
        setError("Falha ao carregar a imagem de referência.");
      }
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  // Reprocessa a imagem de referência quando o aspect ratio muda
  useEffect(() => {
    if (originalFile) {
      processFileWithRatio(originalFile, aspectRatio);
    }
  }, [aspectRatio, originalFile, processFileWithRatio]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setOriginalFile(file);
      // O useEffect cuidará de chamar processFileWithRatio
    }
  };

  const handleRemoveReferenceImage = () => {
    setReferenceImage(null);
    setReferenceImagePreview(null);
    setOriginalFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  
  const handleStartOver = () => {
    setGeneratedImage(null);
    setReferenceImage(null);
    setReferenceImagePreview(null);
    setOriginalFile(null);
    setPrompt('');
    setError(null);
  };

  const handleDownload = (imageUrl: string, ratio: string) => {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `thumbnail-${ratio.replace(':', '-')}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRestoreHistory = (item: HistoryItem) => {
    setGeneratedImage(item.imageUrl);
    setPrompt(item.prompt);
    setAspectRatio(item.aspectRatio);
    setError(null);
    setReferenceImage(null);
    setReferenceImagePreview(null);
    setOriginalFile(null);
  };

  const handleGenerateClick = useCallback(async () => {
    const currentPrompt = prompt.trim();

    if (!currentPrompt) {
      setError(isEditing ? "Por favor, descreva o ajuste desejado." : "Por favor, insira uma descrição para a thumbnail.");
      return;
    }
    setIsLoading(true);
    setError(null);
    
    if (!isEditing) {
        setGeneratedImage(null);
    }

    try {
      let newBase64Image;
      if (isEditing) {
        const imagesForApi = [{
            data: getBase64FromDataUrl(generatedImage!),
            mimeType: 'image/png'
        }];
        
        if (referenceImage) {
            imagesForApi.push(referenceImage);
        }
        
        newBase64Image = await generateImageWithReference(currentPrompt, imagesForApi, aspectRatio);
      } else if (referenceImage) {
        newBase64Image = await generateImageWithReference(currentPrompt, [referenceImage], aspectRatio);
      } else {
        newBase64Image = await generateImageWithText(currentPrompt, aspectRatio);
      }
      
      const finalImageUrl = `data:image/png;base64,${newBase64Image}`;
      setGeneratedImage(finalImageUrl);

      const newHistoryItem: HistoryItem = {
        id: Date.now().toString(),
        imageUrl: finalImageUrl,
        prompt: currentPrompt,
        aspectRatio: aspectRatio,
        timestamp: Date.now(),
      };

      setHistory(prev => [newHistoryItem, ...prev].slice(0, 6));

      setReferenceImage(null);
      setReferenceImagePreview(null);
      setOriginalFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Ocorreu um erro desconhecido ao gerar a imagem.");
    } finally {
      setIsLoading(false);
    }
  }, [prompt, generatedImage, referenceImage, isEditing, aspectRatio]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans p-4 sm:p-6 lg:p-8">
      <div className="container mx-auto max-w-7xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
            Gerador de Thumbnails com IA
          </h1>
          <p className="text-gray-400 mt-2 text-lg">
            Crie, ajuste e aperfeiçoe sua thumbnail dos sonhos.
          </p>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Controls Section */}
          <div className="flex flex-col bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 space-y-6">
            
            {/* Descrição Principal */}
            <div>
                <label htmlFor="prompt" className="text-sm font-bold text-blue-400 uppercase mb-2 block tracking-wider">
                {isEditing ? 'O que mudar?' : 'Descrição do Cenário'}
                </label>
                <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={isEditing ? 'Ex: Adicione explosões ao fundo, mude o céu para roxo...' : 'Ex: Homem segurando controle de videogame, fundo gamer quarto neon...'}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 transition-all h-32 text-gray-200"
                disabled={isLoading}
                />
            </div>

            {/* Proporção */}
            <div>
               <label className="text-sm font-semibold mb-2 text-gray-400 block">Proporção da Imagem</label>
               <div className="flex flex-wrap gap-2">
                  {ASPECT_RATIOS.map((ratio) => (
                      <button
                          key={ratio.value}
                          onClick={() => setAspectRatio(ratio.value)}
                          disabled={isLoading}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                              aspectRatio === ratio.value
                                  ? 'bg-gray-200 text-gray-900 font-bold shadow-md'
                                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                      >
                          {ratio.label}
                      </button>
                  ))}
               </div>
            </div>
            
            {/* Referência */}
            <div>
              <label className="text-sm font-semibold mb-2 text-gray-400 block">
                {isEditing ? 'Adicionar Objeto/Referência Extra (Opcional)' : 'Sua Foto / Referência Principal (Opcional)'}
              </label>
              {referenceImagePreview ? (
                <div className="relative group w-48 border border-gray-600 rounded-lg p-2 bg-gray-900">
                   <img src={referenceImagePreview} alt="Referência" className="w-full h-auto rounded-md" />
                   <button 
                     onClick={handleRemoveReferenceImage}
                     className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                     aria-label="Remover imagem de referência"
                   >
                     <RemoveIcon className="w-4 h-4" />
                   </button>
                   <p className="text-xs text-gray-500 mt-1 text-center">Recorte automático {aspectRatio}</p>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center border border-dashed border-gray-500 hover:border-gray-400"
                  >
                    <UploadIcon className="w-5 h-5 mr-2" />
                    {isEditing ? 'Carregar Referência Extra' : 'Carregar Foto Principal'}
                  </button>
                </div>
              )}
            </div>
            
            <div className="pt-4 flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleGenerateClick}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold py-4 px-4 rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center shadow-lg text-lg"
              >
                {isLoading && <Spinner className="w-6 h-6 mr-2" />}
                {isLoading ? (isEditing ? 'Processando Ajuste...' : 'Gerando...') : (isEditing ? 'Aplicar Ajustes' : 'Gerar Thumbnail')}
              </button>
              {isEditing && (
                <button
                  onClick={handleStartOver}
                  disabled={isLoading}
                  className="w-full sm:w-auto bg-gray-600 text-white font-bold py-4 px-6 rounded-lg hover:bg-gray-500 transition-all duration-300 disabled:opacity-50"
                >
                  Resetar
                </button>
              )}
            </div>
          </div>

          {/* Image Display Section */}
          <div className="flex flex-col items-center justify-center bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 min-h-[500px] relative">
            {isLoading && !generatedImage && (
              <div className="text-center z-10">
                <Spinner className="w-16 h-16 mx-auto text-purple-400" />
                <p className="mt-4 text-gray-400 animate-pulse">Criando sua arte no formato {aspectRatio}...</p>
                <p className="text-sm text-gray-500 mt-2">Isso pode levar alguns segundos.</p>
              </div>
            )}
            {error && (
              <div className="text-center text-red-400">
                <ErrorIcon className="w-16 h-16 mx-auto" />
                <p className="mt-4 font-semibold">Oops! Algo deu errado.</p>
                <p className="text-sm text-gray-500 mt-1">{error}</p>
              </div>
            )}
            {!error && generatedImage && (
              <>
                <div className="relative w-full flex justify-center bg-gray-900 rounded-lg p-2">
                  <img
                      src={generatedImage}
                      alt="Imagem gerada"
                      className={`max-w-full max-h-[600px] object-contain rounded-lg shadow-2xl transition-opacity duration-500 ${isLoading ? 'opacity-50' : 'opacity-100'}`}
                  />
                  {isLoading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-50 rounded-lg">
                          <Spinner className="w-12 h-12 text-purple-400" />
                          <p className="mt-3 text-white font-semibold">Ajustando detalhes...</p>
                      </div>
                  )}
                </div>
                <button
                  onClick={() => handleDownload(generatedImage!, aspectRatio)}
                  disabled={isLoading}
                  className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                >
                  <DownloadIcon className="w-6 h-6 mr-2" />
                  Baixar Imagem (HD)
                </button>
              </>
            )}
            {!isLoading && !error && !generatedImage && (
              <div className="text-center text-gray-500">
                <ImagePlaceholderIcon className="w-24 h-24 mx-auto" />
                <p className="mt-4 text-lg">Sua imagem aparecerá aqui</p>
                <p className="text-sm mt-2 opacity-70">Formato selecionado: {aspectRatio}</p>
              </div>
            )}
          </div>
        </main>

        {/* History Section */}
        {history.length > 0 && (
           <section className="mt-12">
              <h2 className="text-2xl font-bold text-gray-300 mb-6 px-2 border-l-4 border-purple-500">Histórico Recente</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {history.map((item) => (
                      <div 
                        key={item.id} 
                        className="group relative bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-700 hover:border-purple-500 transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
                        onClick={() => handleRestoreHistory(item)}
                      >
                          <div className="aspect-square w-full overflow-hidden bg-gray-900">
                             <img src={item.imageUrl} alt={item.prompt} className="w-full h-full object-cover opacity-90 group-hover:opacity-100" />
                          </div>
                          <div className="p-2">
                              <p className="text-xs text-gray-400 truncate mb-1" title={item.prompt}>{item.prompt}</p>
                              <div className="flex justify-between items-center mt-1">
                                  <span className="text-[10px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">{item.aspectRatio}</span>
                              </div>
                          </div>
                          {/* Hover Overlay */}
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <span className="text-white text-sm font-bold bg-black bg-opacity-60 px-3 py-1 rounded-full backdrop-blur-sm">Carregar</span>
                          </div>
                      </div>
                  ))}
              </div>
           </section>
        )}
      </div>
    </div>
  );
};

export default App;