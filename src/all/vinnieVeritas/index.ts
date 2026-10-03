// Port of keiyoushi/extensions-source src/all/vinnieVeritas/VinnieVeritas.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

const ONCLICK_REGEX = /changeToComic\("(.+?)"\)/;

const DESCRIPTION_EN = "Almost 7 years ago I started working on a project where I would put everything I had drawn, characters, concepts and nonsense that came up while I was growing up .. it was so much I chose a city to put it all in. Like all people who draw, I abandoned many comics and concepts that I thought, sucked.. but I promised myself when I was around 19 years old that I would not abandon this one; because my ability to draw was less than today's, the first two volumes of CCC: The city of the opportunities are… umm, ugly. When I was around 21-22 years old I began to animate in flash, so I decided to animate the world embodied in the comic and continue with the comic this time drawn in flash, therefore Volume 3 has color.\n\nIn this period I had a lot of animation and illustration work would not let me continue the story of CCC: The city of opportunities, the hiatus lasted about 5 years, while I still did animations I did not carried on with the story in the comic .. Now new comics every Thursday.\n\nCCC is the name of the second largest city there is, is not an acronym or an abbreviation for something, CCC: The city of opportunies tells the story of Lucio Vasalle and his misadventures as a newcomer to CCC, comics, drawings and animations are related, they all have bits of story about the characters and their past, you are welcome to explore all this and draw your own conclusions, if you look closely you may find something that someone hasn't noticed yet (:\t\t\t";
const DESCRIPTION_ES = "Hace casi 7 años empecé un proyecto donde iba a meter todas las cosas que había dibujado: personajes, conceptos y tonterias que se me habían ocurrido mientras crecía.. era tanto que pensé que en lo único donde cabría era en una ciudad. Como todos los que dibujamos, abandoné muchos comics y conceptos que no me convencieron al final.. pero me prometí a mi mismo a los 19 años que este comic no lo iba a abandonar; ya que mi habilidad para dibujar era menor a la de hoy en día los primeros dos volumenes de CCC: La ciudad de las oportunidades se ven tan… umm, culeros. Cuando tenía alrededor de 21-22 años comencé a animar en flash y me gustó, decidí animar el mundo que plasmaba en el comic y continuar con la historia dibujada en flash, por eso en el volumen 3 tiene color.\n\nEn este lapso de tiempo tuve mucho trabajo de animación e ilustración que no me dejó continuar con la historieta de CCC: La ciudad de las oportunidades, el hiatus duró mas o menos 5 años, al mismo tiempo animaba pero ya no continuaba con la historia del comic.. Ahora ya la actualizo cada jueves.\n\nCCC es el nombre de la segunda ciudad mas grande que hay, no son siglas ni la abreviación de algo, CCC: La ciudad de las oportunidades narra la historia de Lucio Vasalle y sus desventuras en CCC como recién llegado, el comic, los dibujos sueltos y las animaciones están relacionados, todos cuentan pequeños pedazos de  los personajes y de sus pasados, eres bienvenido a explorar todo esto y sacar tus propias conclusiones, si te fijas bien puede que encuentres algo que alguien no haya notado (:\t\t\t";

export default class VinnieVeritas extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  private createManga(): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain("/archiveIndex.php");
    manga.title = this.lang === "en" ? "CCC: The city of opportunities" : "CCC: La ciudad de las oportunidades";
    manga.artist = "Vinnie Veritas";
    manga.author = "Vinnie Veritas";
    manga.status = SManga.ONGOING;
    manga.description = this.lang === "en" ? DESCRIPTION_EN : DESCRIPTION_ES;
    manga.thumbnail_url = this.lang === "en" ? `${this.baseUrl}/comics/CCCr000E.jpg` : `${this.baseUrl}/comics/CCCr000.jpg`;
    manga.genre = "webcomic";

    return manga;
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    let chapterList: SChapter[];
    if (fetchChapters) {
      const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
      chapterList = document.select(".cccLeftInd .cccArchiveEntry[onclick]").map((element) => {
        const chapter = SChapter.create();
        const comicName = ONCLICK_REGEX.exec(element.attr("onclick"))?.[1] ?? "";
        chapter.url = `/${comicName}.php`;
        chapter.name = element.text();
        return chapter;
      });
    } else {
      chapterList = chapters;
    }

    return new SMangaUpdate(fetchDetails ? this.createManga() : manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const imgSelector = this.lang === "en" ? "img.cccComic.crazylan-en" : "img.cccComic.crazylan-es";
    return document.select(imgSelector).map((image, i) => new Page(i, "", image.absUrl("src")));
  }
}
