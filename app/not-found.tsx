import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <h1 className="text-6xl font-extrabold tracking-tight">404</h1>
        <p className="mt-3 text-lg">Page not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The page you are looking for doesn’t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link href="/" className="btn btn-primary">
            Go to Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}


