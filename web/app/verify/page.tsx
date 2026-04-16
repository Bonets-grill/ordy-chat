export default function VerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-neutral-900">Revisa tu email</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Te hemos enviado un enlace para iniciar sesión. Si no lo ves, revisa la carpeta de spam.
        </p>
      </div>
    </div>
  );
}
