import React, { useState } from 'react';
import { Delete, Lock, User, Eye, EyeOff, ShieldCheck, ChevronLeft } from 'lucide-react';

interface EmployeePinLoginProps {
  onPinSubmit?: (pin: string) => void;
  onCancel?: () => void;
  errorMessage?: string;
  isSubmitting?: boolean;
}

export default function EmployeePinLogin({
  onPinSubmit,
  onCancel,
  errorMessage = '',
  isSubmitting = false
}: EmployeePinLoginProps) {
  const [pin, setPin] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const pinLength = 4; // Standard 4-digit PIN

  const handleKeyPress = (num: string) => {
    if (pin.length < pinLength) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === pinLength && onPinSubmit) {
        // Trigger auto-submit when all digits are filled
        onPinSubmit(newPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--brand-dark,#1e1b4b)] bg-radial-gradient from-slate-900/60 to-slate-950/90 relative overflow-hidden">
      {/* Background glowing brand accents */}
      <div 
        className="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-[120px] opacity-20 pointer-events-none transition duration-1000"
        style={{ backgroundColor: 'var(--brand-primary, #6366f1)' }}
      />
      <div 
        className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full blur-[120px] opacity-25 pointer-events-none transition duration-1000"
        style={{ backgroundColor: 'var(--brand-accent, #a855f7)' }}
      />

      <div className="w-full max-w-sm bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-3xl border border-slate-200/60 dark:border-slate-800/60 shadow-2xl p-6 relative z-10 flex flex-col justify-between min-h-[580px] animate-slide-up">
        
        {/* Header Section */}
        <div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center space-x-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition text-xs font-bold mb-3 cursor-pointer group"
            >
              <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition" />
              <span>Regresar</span>
            </button>
          )}

          <div className="text-center space-y-2 mt-2">
            <div 
              className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center shadow-md animate-bounce"
              style={{ 
                backgroundColor: 'color-mix(in srgb, var(--brand-primary, #6366f1) 12%, white)',
                border: '1px solid color-mix(in srgb, var(--brand-primary, #6366f1) 20%, transparent)'
              }}
            >
              <Lock 
                className="w-5 h-5" 
                style={{ color: 'var(--brand-primary, #6366f1)' }} 
              />
            </div>
            <div>
              <h3 className="font-black text-xl text-slate-800 dark:text-slate-100 tracking-tight">Acceso de Personal</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Introduce tu PIN asignado para iniciar turno</p>
            </div>
          </div>
        </div>

        {/* PIN Indicators Area */}
        <div className="my-6 space-y-4 text-center">
          <div className="flex justify-center items-center space-x-4 h-12">
            {Array.from({ length: pinLength }).map((_, index) => {
              const isActive = index < pin.length;
              return (
                <div
                  key={index}
                  className={`w-4.5 h-4.5 rounded-full border transition-all duration-300 transform ${
                    isActive 
                      ? 'scale-110 shadow-lg' 
                      : 'scale-100 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-850'
                  }`}
                  style={{
                    backgroundColor: isActive ? 'var(--brand-primary, #6366f1)' : undefined,
                    borderColor: isActive ? 'var(--brand-primary, #6366f1)' : undefined,
                    boxShadow: isActive ? '0 0 12px color-mix(in srgb, var(--brand-primary, #6366f1) 50%, transparent)' : undefined
                  }}
                >
                  {isActive && showPin && (
                    <span className="text-white font-extrabold text-[10px] flex items-center justify-center h-full">
                      {pin[index]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Visibility and Clear option */}
          <div className="flex items-center justify-center space-x-4">
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="text-[10px] font-black text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center space-x-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer transition select-none"
            >
              {showPin ? (
                <>
                  <EyeOff className="w-3 h-3" />
                  <span>Ocultar dígitos</span>
                </>
              ) : (
                <>
                  <Eye className="w-3 h-3" />
                  <span>Mostrar dígitos</span>
                </>
              )}
            </button>

            {pin.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="text-[10px] font-black text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 flex items-center space-x-1 px-2.5 py-1 bg-rose-50 dark:bg-rose-950/30 rounded-lg cursor-pointer transition select-none"
              >
                <span>Limpiar</span>
              </button>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-2.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl text-left animate-shake">
              <p className="text-[10px] text-red-600 dark:text-red-400 font-bold leading-normal text-center">
                ⚠️ {errorMessage}
              </p>
            </div>
          )}
        </div>

        {/* Numeric Keypad Grid */}
        <div className="grid grid-cols-3 gap-3.5 max-w-[280px] mx-auto w-full mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
            <button
              key={num}
              type="button"
              disabled={isSubmitting}
              onClick={() => handleKeyPress(num)}
              className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 active:scale-95 text-slate-800 dark:text-slate-100 font-black text-xl flex items-center justify-center border border-slate-100 dark:border-slate-800 shadow-sm cursor-pointer transition duration-150 select-none hover:shadow-md hover:border-slate-200/80"
            >
              {num}
            </button>
          ))}

          {/* Backspace Button */}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleBackspace}
            className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-rose-50 dark:hover:bg-rose-950/20 hover:text-rose-600 hover:border-rose-200 active:scale-95 text-slate-500 font-black flex items-center justify-center border border-slate-100 dark:border-slate-800 shadow-sm cursor-pointer transition duration-150 select-none"
            title="Borrar"
          >
            <Delete className="w-5 h-5" />
          </button>

          {/* Number 0 */}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleKeyPress('0')}
            className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 active:scale-95 text-slate-800 dark:text-slate-100 font-black text-xl flex items-center justify-center border border-slate-100 dark:border-slate-800 shadow-sm cursor-pointer transition duration-150 select-none hover:shadow-md"
          >
            0
          </button>

          {/* Submit/Check Button (Trigger manually if needed, or visual indicator) */}
          <button
            type="button"
            disabled={pin.length < pinLength || isSubmitting}
            onClick={() => onPinSubmit && onPinSubmit(pin)}
            className="w-16 h-16 rounded-2xl flex items-center justify-center border shadow-sm active:scale-95 cursor-pointer transition duration-150 select-none disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: pin.length === pinLength ? 'var(--brand-primary, #6366f1)' : 'var(--brand-primary, #6366f1)10',
              borderColor: pin.length === pinLength ? 'var(--brand-primary, #6366f1)' : 'transparent',
              color: pin.length === pinLength ? '#ffffff' : 'var(--brand-primary, #6366f1)'
            }}
          >
            <ShieldCheck className="w-5 h-5 animate-pulse" />
          </button>
        </div>

        {/* Footer info/brand styling indicator */}
        <div className="text-center pt-2.5 border-t border-slate-100 dark:border-slate-800 flex justify-center items-center space-x-1.5">
          <div className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: 'var(--brand-accent, #a855f7)' }} />
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Seguridad Logic POS
          </span>
        </div>

      </div>
    </div>
  );
}
