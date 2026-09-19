/** Full-viewport shell for all routes; add shared chrome (nav, toasts) here later. */
import { Outlet } from 'react-router-dom';

export default function RootLayout() {
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
      <Outlet />
    </div>
  );
}
