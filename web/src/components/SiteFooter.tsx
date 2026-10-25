import { Link } from 'react-router-dom'
import { BRAND } from './Brand'

/** Footer for /, /why, /choose (spec §2). Lab links live only here. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="sf-inner">
        <div className="sf-col">
          <h3 className="sf-h">Product</h3>
          <Link to="/#how">How it works</Link>
          <Link to="/why">Why it works</Link>
        </div>
        <div className="sf-col">
          <h3 className="sf-h">Use it</h3>
          <Link to="/worker">Worker</Link>
          <Link to="/supervisor">Supervisor</Link>
          <Link to="/buddy">Buddy phone</Link>
        </div>
        <div className="sf-col">
          <h3 className="sf-h">Built at Cal Hacks 13.0</h3>
          <p className="sf-note">Faces are blurred before any frame leaves the browser. No video is stored.</p>
          <p className="sf-lab">
            <Link to="/lab">Lab</Link> · <Link to="/health">Health</Link>
          </p>
        </div>
      </div>
      <p className="sf-bottom">{BRAND} · little steps to independence</p>
    </footer>
  )
}
