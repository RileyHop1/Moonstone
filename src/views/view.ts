export abstract class View {
    protected container: HTMLElement;

    constructor(root: HTMLElement) {

        if (!root) {
            throw new Error("HTMLElement cannot be null");
        }

        this.container = document.createElement('div');
        this.container.classList.add('view-container');


        root.appendChild(this.container);


        this.setup();
    }


    public destroy(): void {

        this.cleanup();

        this.container.remove();
    }

    protected abstract setup(): void;
    protected abstract cleanup(): void;
}