import DropDown from "./DropDown";
import styles from "../styles/GlobalHotBar.module.css";










/**
 * This is is the global hot bar that can be seen throughout the application. 
 * 
 *  
 */
export default function GlobalHotBar() {







    return(
        <div className={styles.HotBar}>
            <DropDown
                name="File"
                options={["New Project", "Open Project", "New File", "Save", "Recent Projects"]}
                onSelect={(option)=> console.log("Selected:", option)}
            />
            <DropDown
                name="Edit"
                options={["Undo", "Redo", "Find & Replace"]}
                onSelect={(option)=> console.log("Selected:", option)}
            />
            <DropDown
                name="Insert"
                options={["Math", "Tables", "Template"]}
                onSelect={(option)=> console.log("Selected:", option)}
            />
            <DropDown
                name="View"
                options={["Source", "Live Preview", "Full Preview"]}
                onSelect={(option)=> console.log("Selected:", option)}
            />
            <DropDown
                name="Settings"
                options={["Light/Dark", "Settings Menu"]}
                onSelect={(option)=> console.log("Selected:", option)}
            />
            <DropDown
                name="Help"
                options={["Documentation"]}
                onSelect={(option)=> console.log("Selected:", option)}
            />






        </div>
    );
}