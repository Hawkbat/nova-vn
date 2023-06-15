
function clickTrap(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
}

const backdrop = <div className="backdrop" /> as HTMLDivElement
const characterBounds = <div id="characterBounds" /> as HTMLDivElement
const viewport = <div id="viewport">
    {backdrop}
    {characterBounds}
</div> as HTMLDivElement
const menu = <div id="menu" onclick={clickTrap} /> as HTMLDivElement
const errorEditor = <div id="errorEditor" /> as HTMLDivElement
const nameplate = <div id="nameplate" /> as HTMLDivElement
const dialogue = <div id="dialogue" /> as HTMLDivElement
const caret = <div id="caret" /> as HTMLDivElement
const textbox = <div id="textbox">
    {nameplate}
    {dialogue}
    {caret}
</div> as HTMLDivElement
const main = <div id="main">
    {viewport}
    {textbox}
    {menu}
    {errorEditor}
</div> as HTMLDivElement

document.body.append(main)
