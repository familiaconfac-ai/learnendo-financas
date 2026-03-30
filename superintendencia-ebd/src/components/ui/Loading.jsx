import './Loading.css'

export function FullScreenLoading() {
  return (
    <div className="fullscreen-loading">
      <div className="loading-spinner" />
      <p className="loading-text">Carregando...</p>
    </div>
  )
}

export function InlineLoading({ text = 'Carregando...' }) {
  return (
    <div className="inline-loading">
      <div className="loading-spinner loading-spinner--sm" />
      <span>{text}</span>
    </div>
  )
}
