import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/SwRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Playverse — games from tomorrow",
    template: "%s · Playverse",
  },
  description:
    "Cinematic real-time 3D games set in one rain-soaked megacity — NEXUS 2100, LONGSHOT, VELOCITY, ECHO. They run in your browser: no install, no account.",
  appleWebApp: {
    capable: true,
    title: "Playverse",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#05060f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // oyun sırasında pinch-zoom'u engelle
  viewportFit: "cover", // çentikli ekranlarda tam kenar
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* paint'ten önce tema uygula — flash yok */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("playverse:theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`,
          }}
        />
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
