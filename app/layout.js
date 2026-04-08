import { Outfit, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

const noto = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
});

export const metadata = {
  title: "🎮 AI 체험관",
  description: "현준이의 · 나만의 AI 체험 세계",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body className={`${outfit.className} ${noto.className}`}>{children}</body>
    </html>
  );
}
