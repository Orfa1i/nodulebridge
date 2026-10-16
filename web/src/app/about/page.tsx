export const metadata = { title: "About · NoduleBridge" };

export default function AboutPage() {
  return (
    <>
      <h1 className="nb-page__title">About NoduleBridge</h1>
      <section className="ak-card">
        <div className="nb-prose">
          <h2>What it does</h2>
          <p>
            An emergency CT done for another reason can show an incidental lung nodule that gets
            buried in the report. NoduleBridge finds the nodule sentence, shows the nodule in a CT
            viewer, applies the Fleischner Society 2017 follow-up rules, and explains the next step
            in plain Arabic and English.
          </p>
          <h2>What it does not do</h2>
          <p>
            Decision and adherence support only — not a diagnosis. Follow-up decisions belong to
            your doctor. AI-assisted outputs show their confidence and are labelled.
          </p>
          <h2>Data credits</h2>
          <ul>
            <li>
              CT images: The Cancer Imaging Archive (TCIA), LIDC-IDRI collection, licence CC BY
              3.0. TODO-VERIFY: full citation text from the TCIA collection page.
            </li>
            <li>Reports are written by the team as examples. No real patient data is used.</li>
          </ul>
          <h2>Team</h2>
          <p>TODO-VERIFY: team member names and roles.</p>
        </div>
      </section>
    </>
  );
}
