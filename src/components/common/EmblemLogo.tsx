import React from 'react';

interface EmblemLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const EmblemLogo: React.FC<EmblemLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
}) => {
  const sizeMap = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Logo Resmi Madrasah Aliyah Sirajul Huda Marindi */}
      <div className={`relative ${sizeMap[size]} shrink-0 flex items-center justify-center overflow-hidden`}>
        <img
          src="/assets/aistudio/logo_ma_sirajul_huda_transparan_245730dd.png"
          alt="Logo Madrasah Aliyah Sirajul Huda Marindi"
          className="w-full h-full object-contain drop-shadow-xs"
        />
      </div>

      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-bold tracking-tight text-slate-900 text-sm md:text-base leading-tight">
              CBT SIRAJUL HUDA
            </span>
            <span className="text-[10px] uppercase font-semibold tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              MARINDI
            </span>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            Madrasah Aliyah Sirajul Huda
          </span>
        </div>
      )}
    </div>
  );
};
