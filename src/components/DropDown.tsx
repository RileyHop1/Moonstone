
import { useEffect, useState, useRef } from "react";
import styles from "../styles/DropDown.module.css";





interface DropDownProps {
    /** Label shown on the dropdown button. */
    name: string;
    /** Options listed in the menu when it's open. */
    options: string[];
    /** Called with the chosen option when the user clicks an item. */
    onSelect: (option: string) => void;


}



/**
 * A simple menu dropdown: a labelled button that reveals a list of
 * options and reports the user's choice through onSelect.
 */
export default function DropDown({ name, options, onSelect }: DropDownProps) {



    const [isOpen, setIsOpen] = useState(false);
    const dropDownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {

        if (!isOpen) return;

        function handleClick(event: MouseEvent) {

            if (dropDownRef.current && ! dropDownRef.current.contains(event.target as Node))
                setIsOpen(false);

        }

        document.addEventListener("mousedown", handleClick);

        return () => {
            document.removeEventListener("mousedown", handleClick);


        };
    }, [isOpen]);


    return(
        <div className={styles.dropdownContainer} ref={dropDownRef} >
            <button className={styles.dropdownTrigger} onClick={() => setIsOpen(!isOpen)}>
                { name }
            </button>
            { isOpen && 
                (
                    <ul  className={styles.dropdownMenu} >
                        {
                            options.map((option) => <li className={styles.dropdownItem} key={option} onClick={
                                () => {onSelect(option); setIsOpen(false);}}>{ option }</li>)
                        }
                    </ul>
                )
            }


        </div>
    );


}

