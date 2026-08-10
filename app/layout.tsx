import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import "katex/dist/katex.min.css";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Coder",
  description: "Pi Coder interface for the pi coding agent",
  applicationName: "Pi Coder",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pi Coder",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var root=document.documentElement;var mode=localStorage.getItem("pi-theme-mode");var legacy=localStorage.getItem("pi-theme");if(!mode&&(legacy==="light"||legacy==="dark")){mode=legacy;localStorage.setItem("pi-theme-mode",mode);localStorage.removeItem("pi-theme");}if(mode!=="light"&&mode!=="dark"){mode="light";}var themeName=localStorage.getItem("pi-theme-name")||"";root.classList.toggle("dark",mode==="dark");root.dataset.themeMode=mode;if(themeName){root.dataset.theme=themeName;}else{delete root.dataset.theme;}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate">
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
