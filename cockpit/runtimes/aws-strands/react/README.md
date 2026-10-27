# AWS Strands React meetings

Experimental source-build preview of native Session interrupt/resume for a fictional meeting. Choose the editable Q3 roadmap preset or write a request, Send, then Approve or Decline. Stop cancels the current operation; an unconfirmed outcome requires New conversation. New clears local conversation authority. Completed conversations support another explicit Send in the same Session. If cleanup fails, this preview permanently disables execution and New conversation; reload the preview to continue. A successful fallback teardown does not erase the original cleanup failure.

The backend uses a process-global fictional demo calendar, not a calendar isolated per thread. No real meeting is booked. The last observed availability/booking snapshot is separate from the approval fields and canonical booking result. Sequential execution may leave the observed booking snapshot pending even after a confirmed result; batched lookup/booking execution may publish booked or declined. The UI displays the snapshot it actually received.

The decision belongs to one current root native interrupt and exactly one unresolved book_meeting declaration. Native Session alone executes. Completion requires its successful resumed run, matching root terminal and exact original booking tool result; assistant prose and shared state do not confirm a booking. The canonical AG-UI result is decoded once for display and retained unchanged internally.

This example demonstrates the meeting decision, not full researcher/subagent parity. It does not claim public npm package availability. The build installs packed local React/core/content and AG-UI candidate packages in an isolated consumer. Runtime bridge configuration is fixed at bootstrap; there is no live connection selector.

From the repository root, using its npm-installed tools:

```sh
npx nx test cockpit-runtimes-aws-strands-react --skip-nx-cache
npx nx lint cockpit-runtimes-aws-strands-react --skip-nx-cache
npx nx build cockpit-runtimes-aws-strands-react --skip-nx-cache
npx nx e2e cockpit-runtimes-aws-strands-react --skip-nx-cache
```

The e2e target prepares the isolated Python fixture and builds before serving port 4643. Its loopback model seam drives the unchanged actual Strands service; positive AG-UI bytes are untouched, with original upstream/sent bodies retained as browser evidence. No external model credentials or real bookings are used. Negative terminal scenarios are explicitly corrupted local-only streams. Preparation requires Python 3.12 and the frozen uv environment. Local serving: `node scripts/react-cockpit/serve.mjs runtimes-aws-strands --no-parent` after build (browser tests explicitly reset the fixture before Send).
