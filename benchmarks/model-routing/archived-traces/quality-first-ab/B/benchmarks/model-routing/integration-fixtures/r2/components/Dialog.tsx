'use client';

import { useState } from 'react';

export function Dialog() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Delete project
      </button>
      {open ? (
        <div role="presentation" className="overlay">
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog">
            <h2 id="dialog-title">Delete project?</h2>
            <p>This action cannot be undone.</p>
            <button type="button" onClick={() => setOpen(false)}>
              Confirm
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
