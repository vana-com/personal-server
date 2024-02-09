import { FaGithub } from "react-icons/fa";

export const Header = () => (
  // <header>
  //   <h1>Selfie</h1>
  // </header>
  <div className="navbar bg-base-100">
    {/*<a className="btn btn-ghost text-xl" href="/">Selfie</a>*/}
    <h1 className="text-3xl p-4">Selfie</h1>
    <div className="flex-grow"></div>

    <a className="mr-8 link link-hover" href="/docs" rel="noopener noreferrer">
      API Docs
    </a>

    <a href="https://github.com/vana-com/selfie" target="_blank" rel="noopener noreferrer">
      <FaGithub className="w-6 h-6 mr-4"/>
    </a>
  </div>
);
