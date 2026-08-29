import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SertexMain from "@/components/SertexMain";
import LoginScreen from "@/components/LoginScreen";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ConfirmRoot } from "@/lib/confirm";
import { Loader2 } from "lucide-react";

const Gate = () => {
  const { user } = useAuth();

  if (user === undefined) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-sertex-bg">
        <div className="flex items-center gap-2 text-sertex-cyan hud-text">
          <Loader2 className="h-4 w-4 animate-spin" />
          BAĞLANIYOR...
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;
  return <SertexMain />;
};

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Gate />} />
          </Routes>
        </BrowserRouter>
        <ConfirmRoot />
      </AuthProvider>
    </div>
  );
}

export default App;
