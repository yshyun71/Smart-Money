const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 1. Master Standard SVG (for icon.svg, pwa-192x192, pwa-512x512, apple-touch-icon)
const masterSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient: Deep Luxury Emerald & Slate -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#047857" />
      <stop offset="50%" stop-color="#059669" />
      <stop offset="100%" stop-color="#064E3B" />
    </linearGradient>

    <!-- Top Glow Overlay -->
    <radialGradient id="topGlow" cx="30%" cy="15%" r="65%">
      <stop offset="0%" stop-color="#34D399" stop-opacity="0.45" />
      <stop offset="100%" stop-color="#047857" stop-opacity="0" />
    </radialGradient>

    <!-- Credit Card Gradient -->
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>

    <!-- Card Accent Ribbon -->
    <linearGradient id="ribbonGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10B981" />
      <stop offset="50%" stop-color="#06B6D4" />
      <stop offset="100%" stop-color="#3B82F6" />
    </linearGradient>

    <!-- Gold Coin Bevel Gradient -->
    <linearGradient id="goldBevel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="30%" stop-color="#F59E0B" />
      <stop offset="70%" stop-color="#D97706" />
      <stop offset="100%" stop-color="#78350F" />
    </linearGradient>

    <!-- Gold Coin Face Gradient -->
    <linearGradient id="goldFace" x1="20%" y1="20%" x2="80%" y2="80%">
      <stop offset="0%" stop-color="#FEF3C7" />
      <stop offset="45%" stop-color="#FBBF24" />
      <stop offset="100%" stop-color="#D97706" />
    </linearGradient>

    <!-- Chip Gold Gradient -->
    <linearGradient id="chipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="100%" stop-color="#D97706" />
    </linearGradient>

    <!-- Drop Shadows -->
    <filter id="mainShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#022C22" flood-opacity="0.55" />
    </filter>

    <filter id="coinShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.45" />
    </filter>

    <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Squircle Base -->
  <rect width="512" height="512" rx="118" fill="url(#bgGrad)" />
  <rect width="512" height="512" rx="118" fill="url(#topGlow)" />
  <rect width="504" height="504" x="4" y="4" rx="114" fill="none" stroke="#6EE7B7" stroke-opacity="0.25" stroke-width="4" />

  <!-- Smart Credit Card in background -->
  <g filter="url(#mainShadow)">
    <!-- Card Body -->
    <rect x="72" y="104" width="340" height="216" rx="26" fill="url(#cardGrad)" stroke="#334155" stroke-width="3" />
    
    <!-- Decorative Futuristic Financial Curves on Card -->
    <path d="M 72 170 Q 200 140 412 180" fill="none" stroke="url(#ribbonGrad)" stroke-width="4" opacity="0.85" />
    <path d="M 72 190 Q 220 160 412 210" fill="none" stroke="#10B981" stroke-width="2" opacity="0.4" />

    <!-- EMV Smart Chip -->
    <rect x="112" y="148" width="56" height="42" rx="8" fill="url(#chipGrad)" stroke="#B45309" stroke-width="2" />
    <path d="M 112 169 H 168 M 140 148 V 190" stroke="#92400E" stroke-width="2" opacity="0.8" />
    <circle cx="140" cy="169" r="6" fill="#FDE68A" />

    <!-- Contactless Wireless Indicator Wave -->
    <path d="M 190 156 A 14 14 0 0 1 190 182 M 200 150 A 24 24 0 0 1 200 188 M 210 144 A 34 34 0 0 1 210 194" 
          fill="none" stroke="#64748B" stroke-width="3.5" stroke-linecap="round" />

    <!-- Cardholder / Smart AI Ledger lines -->
    <rect x="112" y="248" width="140" height="10" rx="5" fill="#475569" />
    <rect x="112" y="268" width="80" height="8" rx="4" fill="#334155" />

    <!-- Upward Trend Chart Line on top-right of card -->
    <g transform="translate(290, 130)">
      <polyline points="0,55 30,42 60,48 90,20" fill="none" stroke="#34D399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <!-- Arrow Head -->
      <polygon points="94,14 78,22 88,32" fill="#34D399" />
      <circle cx="0" cy="55" r="4" fill="#34D399" />
      <circle cx="30" cy="42" r="4" fill="#34D399" />
      <circle cx="60" cy="48" r="4" fill="#34D399" />
      <circle cx="90" cy="20" r="5" fill="#6EE7B7" />
    </g>
  </g>

  <!-- Big Glowing 3D Smart Won Coin in Foreground -->
  <g filter="url(#coinShadow)">
    <!-- Outer Golden Rim with 3D Bevel -->
    <circle cx="336" cy="336" r="112" fill="url(#goldBevel)" stroke="#F59E0B" stroke-width="2" />
    
    <!-- Inner Coin Face -->
    <circle cx="336" cy="336" r="98" fill="url(#goldFace)" />
    
    <!-- Coin Inner Inset Border -->
    <circle cx="336" cy="336" r="88" fill="none" stroke="#FDE68A" stroke-width="3" stroke-dasharray="6,4" opacity="0.8" />

    <!-- Korean Won (₩) Symbol - Crisp Precision Vector Path -->
    <!-- Double Horizontal Bars -->
    <rect x="274" y="316" width="124" height="12" rx="6" fill="#78350F" />
    <rect x="274" y="344" width="124" height="12" rx="6" fill="#78350F" />

    <!-- W Stem Path with high-contrast sharp contours -->
    <path d="M 276 288 
             L 294 288 
             L 322 376 
             L 336 332 
             L 350 376 
             L 378 288 
             L 396 288 
             L 362 392 
             L 340 392 
             L 336 376 
             L 332 392 
             L 310 392 Z" 
          fill="#78350F" />

    <!-- Won Inner White/Gold Highlights for 3D depth -->
    <path d="M 280 292 
             L 292 292 
             L 320 374 
             L 336 324 
             L 352 374 
             L 380 292 
             L 392 292 
             L 360 388 
             L 342 388 
             L 336 368 
             L 330 388 
             L 312 388 Z" 
          fill="#FFFBEB" opacity="0.95" />
    
    <rect x="278" y="318" width="116" height="8" rx="4" fill="#FFFBEB" opacity="0.9" />
    <rect x="278" y="346" width="116" height="8" rx="4" fill="#FFFBEB" opacity="0.9" />
  </g>

  <!-- Futuristic AI Sparkles (✦) -->
  <!-- Top Right Big Sparkle -->
  <g transform="translate(424, 76)" filter="url(#glowEffect)">
    <path d="M 0 -24 Q 0 0 24 0 Q 0 0 0 24 Q 0 0 -24 0 Q 0 0 0 -24 Z" fill="#FDE68A" />
    <circle cx="0" cy="0" r="4" fill="#FFFFFF" />
  </g>

  <!-- Left Small Sparkle -->
  <g transform="translate(74, 340)">
    <path d="M 0 -14 Q 0 0 14 0 Q 0 0 0 14 Q 0 0 -14 0 Q 0 0 0 -14 Z" fill="#6EE7B7" opacity="0.9" />
  </g>

  <!-- Bottom Right Mini Star -->
  <g transform="translate(460, 430)">
    <path d="M 0 -10 Q 0 0 10 0 Q 0 0 0 10 Q 0 0 -10 0 Q 0 0 0 -10 Z" fill="#FCD34D" opacity="0.8" />
  </g>
</svg>
`;

// 2. Maskable SVG: Android adaptive icons require a 20% safe-zone margin around the center
// Scaled & centered inside 512x512 with full background coverage
const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#047857" />
      <stop offset="50%" stop-color="#059669" />
      <stop offset="100%" stop-color="#064E3B" />
    </linearGradient>
    <radialGradient id="topGlow" cx="30%" cy="15%" r="65%">
      <stop offset="0%" stop-color="#34D399" stop-opacity="0.4" />
      <stop offset="100%" stop-color="#047857" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
    <linearGradient id="ribbonGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10B981" />
      <stop offset="50%" stop-color="#06B6D4" />
      <stop offset="100%" stop-color="#3B82F6" />
    </linearGradient>
    <linearGradient id="goldBevel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="30%" stop-color="#F59E0B" />
      <stop offset="70%" stop-color="#D97706" />
      <stop offset="100%" stop-color="#78350F" />
    </linearGradient>
    <linearGradient id="goldFace" x1="20%" y1="20%" x2="80%" y2="80%">
      <stop offset="0%" stop-color="#FEF3C7" />
      <stop offset="45%" stop-color="#FBBF24" />
      <stop offset="100%" stop-color="#D97706" />
    </linearGradient>
    <linearGradient id="chipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="100%" stop-color="#D97706" />
    </linearGradient>
    <filter id="mainShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#022C22" flood-opacity="0.5" />
    </filter>
    <filter id="coinShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.45" />
    </filter>
  </defs>

  <!-- Full Bleed Background for Maskable Icon -->
  <rect width="512" height="512" fill="url(#bgGrad)" />
  <rect width="512" height="512" fill="url(#topGlow)" />

  <!-- Center Scaled Elements (Scale: 0.76, centered at 256, 256) -->
  <g transform="translate(62, 62) scale(0.76)">
    <!-- Credit Card -->
    <g filter="url(#mainShadow)">
      <rect x="72" y="104" width="340" height="216" rx="26" fill="url(#cardGrad)" stroke="#334155" stroke-width="3" />
      <path d="M 72 170 Q 200 140 412 180" fill="none" stroke="url(#ribbonGrad)" stroke-width="4" opacity="0.85" />
      <rect x="112" y="148" width="56" height="42" rx="8" fill="url(#chipGrad)" stroke="#B45309" stroke-width="2" />
      <path d="M 112 169 H 168 M 140 148 V 190" stroke="#92400E" stroke-width="2" opacity="0.8" />
      <path d="M 190 156 A 14 14 0 0 1 190 182 M 200 150 A 24 24 0 0 1 200 188" fill="none" stroke="#64748B" stroke-width="3" stroke-linecap="round" />
      <rect x="112" y="248" width="140" height="10" rx="5" fill="#475569" />
      
      <!-- Upward Trend Chart Line -->
      <g transform="translate(290, 130)">
        <polyline points="0,55 30,42 60,48 90,20" fill="none" stroke="#34D399" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        <polygon points="94,14 78,22 88,32" fill="#34D399" />
      </g>
    </g>

    <!-- Coin in Foreground -->
    <g filter="url(#coinShadow)">
      <circle cx="336" cy="336" r="112" fill="url(#goldBevel)" stroke="#F59E0B" stroke-width="2" />
      <circle cx="336" cy="336" r="98" fill="url(#goldFace)" />
      <circle cx="336" cy="336" r="88" fill="none" stroke="#FDE68A" stroke-width="3" stroke-dasharray="6,4" opacity="0.8" />
      
      <rect x="274" y="316" width="124" height="12" rx="6" fill="#78350F" />
      <rect x="274" y="344" width="124" height="12" rx="6" fill="#78350F" />
      <path d="M 276 288 L 294 288 L 322 376 L 336 332 L 350 376 L 378 288 L 396 288 L 362 392 L 340 392 L 336 376 L 332 392 L 310 392 Z" fill="#78350F" />
      <path d="M 280 292 L 292 292 L 320 374 L 336 324 L 352 374 L 380 292 L 392 292 L 360 388 L 342 388 L 336 368 L 330 388 L 312 388 Z" fill="#FFFBEB" opacity="0.95" />
      <rect x="278" y="318" width="116" height="8" rx="4" fill="#FFFBEB" opacity="0.9" />
      <rect x="278" y="346" width="116" height="8" rx="4" fill="#FFFBEB" opacity="0.9" />
    </g>

    <!-- Sparkles -->
    <g transform="translate(424, 76)">
      <path d="M 0 -24 Q 0 0 24 0 Q 0 0 0 24 Q 0 0 -24 0 Q 0 0 0 -24 Z" fill="#FDE68A" />
      <circle cx="0" cy="0" r="4" fill="#FFFFFF" />
    </g>
    <g transform="translate(74, 340)">
      <path d="M 0 -14 Q 0 0 14 0 Q 0 0 0 14 Q 0 0 -14 0 Q 0 0 0 -14 Z" fill="#6EE7B7" opacity="0.9" />
    </g>
  </g>
</svg>
`;

async function main() {
  const publicDir = path.join(__dirname, '..', 'public');

  // 1. Write icon.svg
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), masterSvg.trim());
  console.log('Written public/icon.svg');

  // 2. Generate pwa-512x512.png (512x512)
  await sharp(Buffer.from(masterSvg))
    .resize(512, 512)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(publicDir, 'pwa-512x512.png'));
  console.log('Generated public/pwa-512x512.png');

  // 3. Generate pwa-192x192.png (192x192)
  await sharp(Buffer.from(masterSvg))
    .resize(192, 192)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(publicDir, 'pwa-192x192.png'));
  console.log('Generated public/pwa-192x192.png');

  // 4. Generate apple-touch-icon.png (180x180)
  await sharp(Buffer.from(masterSvg))
    .resize(180, 180)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Generated public/apple-touch-icon.png');

  // 5. Generate pwa-maskable-512x512.png (512x512 safe zone)
  await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
  console.log('Generated public/pwa-maskable-512x512.png');

  console.log('All Smart Money icons successfully generated!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
