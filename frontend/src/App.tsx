import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { S } from "./strings";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">
        <header className="app__header">{S.app.name}</header>
        <main className="app__main">{S.app.tagline}</main>
      </div>
    </QueryClientProvider>
  );
}

export default App;
