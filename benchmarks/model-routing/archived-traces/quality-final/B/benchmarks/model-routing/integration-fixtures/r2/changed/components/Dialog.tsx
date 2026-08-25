'use client';

import { useState } from 'react';

export function Dialog() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="open-control" onClick={() => setOpen(true)}>
        Delete project
      </div>
      {open ? (
        <div className="overlay">
          <div className="dialog">
            <h2>Delete project?</h2>
            <p>This action cannot be undone.</p>
            <div className="confirm" onClick={() => setOpen(false)}>
              Confirm
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
