import type { Metadata } from "next";
import "./globals.css";
import LocalQuizRendererClient from "./local-quiz-renderer-client";

export const metadata: Metadata = {
  title: "Corvo Library V2",
  description: "Biblioteca semântica de mídia — arquitetura limpa",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><LocalQuizRendererClient />{children}</body></html>;
}
