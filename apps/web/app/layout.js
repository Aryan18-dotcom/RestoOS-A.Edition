import "./globals.css";
import { Toaster } from "sonner";
export const metadata = { title: "RestaurantOS", description: "Restaurant operations platform" };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}<Toaster richColors position="top-right" /></body></html>;
}
