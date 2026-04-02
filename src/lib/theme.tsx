import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type ThemeColor = 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'custom';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  colorTheme: ThemeColor;
  setColorTheme: (colorTheme: ThemeColor) => void;
  customColor: string;
  setCustomColor: (customColor: string) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);
const CUSTOM_THEME_VAR_NAMES = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--info',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
  '--active-glow',
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(input: string) {
  const value = String(input || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return `#${value.toLowerCase()}`;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) };
  }

  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);

  let hue = 0;
  switch (max) {
    case red:
      hue = ((green - blue) / delta) + (green < blue ? 6 : 0);
      break;
    case green:
      hue = ((blue - red) / delta) + 2;
      break;
    default:
      hue = ((red - green) / delta) + 4;
      break;
  }

  hue = Math.round(hue * 60);

  return {
    h: hue,
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

function createCustomThemeVariables(theme: Theme, customColor: string) {
  const rgb = hexToRgb(customColor);
  if (!rgb) return null;

  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const infoHue = (hsl.h + 18) % 360;

  if (theme === 'dark') {
    const primaryLightness = clamp(Math.max(hsl.l, 62), 62, 70);
    const infoLightness = clamp(primaryLightness + 6, 64, 76);
    const saturation = clamp(Math.max(hsl.s, 65), 65, 92);

    return {
      '--primary': `${hsl.h} ${saturation}% ${primaryLightness}%`,
      '--primary-foreground': '255 36% 9%',
      '--ring': `${hsl.h} ${saturation}% ${primaryLightness}%`,
      '--info': `${infoHue} ${clamp(saturation - 8, 52, 88)}% ${infoLightness}%`,
      '--sidebar-primary': `${hsl.h} ${saturation}% ${primaryLightness}%`,
      '--sidebar-primary-foreground': '255 36% 9%',
      '--sidebar-ring': `${hsl.h} ${saturation}% ${primaryLightness}%`,
      '--active-glow': `0 0 18px 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`,
    };
  }

  const primaryLightness = clamp(hsl.l, 46, 58);
  const saturation = clamp(Math.max(hsl.s, 60), 60, 88);

  return {
    '--primary': `${hsl.h} ${saturation}% ${primaryLightness}%`,
    '--primary-foreground': '0 0% 100%',
    '--ring': `${hsl.h} ${saturation}% ${primaryLightness}%`,
    '--info': `${infoHue} ${clamp(saturation - 6, 48, 84)}% ${clamp(primaryLightness + 4, 50, 64)}%`,
    '--sidebar-primary': `${hsl.h} ${saturation}% ${primaryLightness}%`,
    '--sidebar-primary-foreground': '0 0% 100%',
    '--sidebar-ring': `${hsl.h} ${saturation}% ${primaryLightness}%`,
    '--active-glow': `0 0 18px 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`,
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('cpm-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // default: dark
  });
  const [colorTheme, setColorTheme] = useState<ThemeColor>(() => {
    const saved = localStorage.getItem('cpm-color-theme');
    if (
      saved === 'violet' ||
      saved === 'blue' ||
      saved === 'emerald' ||
      saved === 'amber' ||
      saved === 'rose' ||
      saved === 'custom'
    ) {
      return saved;
    }
    return 'violet';
  });
  const [customColor, setCustomColor] = useState(() => normalizeHex(localStorage.getItem('cpm-custom-color') || '') || '#a855f7');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    localStorage.setItem('cpm-theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorTheme = colorTheme;
    localStorage.setItem('cpm-color-theme', colorTheme);

    CUSTOM_THEME_VAR_NAMES.forEach((name) => {
      root.style.removeProperty(name);
    });

    if (colorTheme === 'custom') {
      const variables = createCustomThemeVariables(theme, customColor);
      if (variables) {
        Object.entries(variables).forEach(([name, value]) => {
          root.style.setProperty(name, value);
        });
      }
    }
  }, [colorTheme, customColor, theme]);

  useEffect(() => {
    localStorage.setItem('cpm-custom-color', customColor);
  }, [customColor]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colorTheme, setColorTheme, customColor, setCustomColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
