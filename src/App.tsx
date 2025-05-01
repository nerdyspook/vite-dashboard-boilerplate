import { useState } from "react";
import Layout from "@/components/custom/layout/layout";

function App() {
  const [count, setCount] = useState(0);

  return (
    <Layout>
      <div className="flex flex-col max-h-full gap-4 overflow-auto">
        <div className="grid auto-rows-min gap-4 md:grid-cols-3">
          <div className="aspect-video rounded-xl bg-muted/50" />
          <div className="aspect-video rounded-xl bg-muted/50" />
          <div className="aspect-video rounded-xl bg-muted/50" />
        </div>
        <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min" />
      </div>
    </Layout>
  );
}

export default App;
